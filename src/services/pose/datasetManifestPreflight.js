// HUM-100-K: dataset manifest metadata preflight (spec §15/§18/§42 ML gates).
// Validates the v1 manifest contract BEFORE any training run may consume it.
// Two layers: structural metadata (schema shape, partitions, digests) and
// source licensing (every source must be ingest-legal for BOTH training and
// evaluation because v1 does not attribute sources to individual splits).
// Diagnostics use stable error codes only — subject pseudonyms and storage
// references never appear in rejection output.
const { lookup, gateIngest } = require('./datasetLicensing');

const SHA256_RE = /^[0-9a-f]{64}$/;

function err(code, detail) {
  return { code, detail };
}

function validateStructure(manifest, expectedDatasetVersion) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [err('MANIFEST_MALFORMED', 'manifest must be an object')];
  }
  if (manifest.schemaVersion !== 1) errors.push(err('MANIFEST_MALFORMED', 'schemaVersion must be 1'));
  if (typeof manifest.datasetVersion !== 'string' || !manifest.datasetVersion) {
    errors.push(err('MANIFEST_MALFORMED', 'datasetVersion must be a non-empty string'));
  } else if (expectedDatasetVersion && manifest.datasetVersion !== expectedDatasetVersion) {
    errors.push(err('MANIFEST_VERSION_MISMATCH', 'manifest datasetVersion does not match the expected version'));
  }
  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
    errors.push(err('MANIFEST_MALFORMED', 'generatedAt must be a valid date-time string'));
  }

  // ── subjects: declared set, unique ─────────────────────────────────────
  const subjects = manifest.subjects;
  if (!Array.isArray(subjects) || !subjects.length) {
    errors.push(err('MANIFEST_MALFORMED', 'subjects must be a non-empty array'));
  } else {
    const seen = new Set();
    let dup = false;
    for (const s of subjects) {
      if (typeof s !== 'string' || s.length < 4) { errors.push(err('MANIFEST_MALFORMED', 'subject ids must be strings of at least 4 chars')); break; }
      if (seen.has(s)) { dup = true; break; }
      seen.add(s);
    }
    if (dup) errors.push(err('MANIFEST_DUPLICATE_SUBJECT', 'duplicate subject ids in declared subjects'));
  }

  // ── splits: nonempty, disjoint, exhaustive partition of subjects ───────
  const splits = manifest.splits;
  const declaredCount = Array.isArray(subjects) ? subjects.length : 0;
  if (!splits || typeof splits !== 'object') {
    errors.push(err('MANIFEST_MALFORMED', 'splits object required'));
  } else {
    const SPLIT_KEYS = ['train', 'validation', 'test'];
    const memberships = {};
    for (const key of SPLIT_KEYS) {
      const arr = splits[key];
      if (!Array.isArray(arr) || !arr.length) {
        errors.push(err('MANIFEST_SPLIT_EMPTY', `split '${key}' must be a non-empty array`));
        memberships[key] = [];
        continue;
      }
      memberships[key] = arr;
    }
    if (splits.policy !== 'participant_disjoint') {
      errors.push(err('MANIFEST_MALFORMED', 'splits.policy must be participant_disjoint'));
    }
    // overlap across splits
    const counts = new Map();
    for (const key of SPLIT_KEYS) for (const s of memberships[key] || []) counts.set(s, (counts.get(s) || 0) + 1);
    if ([...counts.values()].some((c) => c > 1)) {
      errors.push(err('MANIFEST_SPLIT_OVERLAP', 'a subject appears in more than one split'));
    }
    // unknown subjects (in splits but not declared)
    const declared = new Set(Array.isArray(subjects) ? subjects : []);
    if ([...counts.keys()].some((s) => !declared.has(s))) {
      errors.push(err('MANIFEST_SPLIT_UNKNOWN_SUBJECT', 'splits reference subjects absent from the declared subjects set'));
    }
    // omitted subjects (declared but in no split) — partition must be exhaustive
    if (declaredCount && [...declared].some((s) => !counts.has(s))) {
      errors.push(err('MANIFEST_SPLIT_INCOMPLETE', 'declared subjects missing from every split — partition must be exhaustive'));
    }
  }

  // ── provenance: unique source ids, valid digests ───────────────────────
  const sources = manifest.provenance && manifest.provenance.sources;
  if (!Array.isArray(sources) || !sources.length) {
    errors.push(err('MANIFEST_MALFORMED', 'provenance.sources must be a non-empty array'));
  } else {
    const ids = new Set();
    for (const s of sources) {
      if (!s || typeof s !== 'object') { errors.push(err('MANIFEST_MALFORMED', 'source entries must be objects')); continue; }
      if (typeof s.sourceId !== 'string' || !s.sourceId) {
        errors.push(err('MANIFEST_MALFORMED', 'every source requires a sourceId'));
      } else if (ids.has(s.sourceId)) {
        errors.push(err('MANIFEST_DUPLICATE_SOURCE', 'duplicate source ids in provenance'));
      } else ids.add(s.sourceId);
      if (typeof s.sha256 !== 'string' || !SHA256_RE.test(s.sha256)) {
        errors.push(err('MANIFEST_INVALID_DIGEST', 'every source requires a lowercase hex sha256 digest'));
      }
      if (!['in_house_capture', 'licensed_dataset', 'subject_contributed', 'public_domain'].includes(s.kind)) {
        errors.push(err('MANIFEST_MALFORMED', 'source kind must be in_house_capture|licensed_dataset|subject_contributed|public_domain'));
      }
    }
  }

  // ── retention ──────────────────────────────────────────────────────────
  const ret = manifest.retention;
  if (!ret || typeof ret !== 'object' || !['restricted_role', 'annotator_only', 'denied'].includes(ret.rawAccess) || typeof ret.deletionProcedure !== 'string' || !ret.deletionProcedure) {
    errors.push(err('MANIFEST_MALFORMED', 'retention requires rawAccess enum + deletionProcedure'));
  }
  return errors;
}

function validateSourceLicensing(manifest) {
  // v1 has no source-to-split mapping, so EVERY declared source must be
  // ingest-legal for BOTH training and evaluation — anything less would let
  // a restricted source reach a split it was never cleared for.
  const errors = [];
  const sources = (manifest.provenance && manifest.provenance.sources) || [];
  for (const s of sources) {
    if (!s || typeof s.sourceId !== 'string' || !s.sourceId) continue;
    const entry = lookup(s.sourceId);
    if (!entry) {
      errors.push(err('MANIFEST_SOURCE_UNKNOWN', 'a declared source is absent from the licensing registry — default PROHIBITED'));
      continue;
    }
    const forTraining = gateIngest(s.sourceId, { purpose: 'training' });
    const forEvaluation = gateIngest(s.sourceId, { purpose: 'evaluation' });
    if (!forTraining.allowed || !forEvaluation.allowed) {
      if (entry.commercialTraining === 'prohibited') {
        errors.push(err('MANIFEST_SOURCE_PROHIBITED', 'a declared source is license-prohibited for commercial training'));
      } else if (entry.commercialTraining === 'restricted') {
        errors.push(err('MANIFEST_SOURCE_RESTRICTED', 'a declared source is license-restricted and not cleared for training+evaluation'));
      } else {
        errors.push(err('MANIFEST_SOURCE_NOT_SUITABLE', 'a declared source is not suitable for both training and evaluation (e.g. smoke-only fixtures)'));
      }
    }
  }
  return errors;
}

function preflightManifest(manifest, { expectedDatasetVersion = null } = {}) {
  const structural = validateStructure(manifest, expectedDatasetVersion);
  // licensing validation only runs when structure is sound — a malformed
  // manifest has no trustworthy source list to evaluate
  const licensing = structural.length ? [] : validateSourceLicensing(manifest);
  const errors = [...structural, ...licensing];
  return {
    valid: errors.length === 0,
    errors,
    codes: errors.map((e) => e.code),
  };
}

module.exports = { preflightManifest, validateStructure, validateSourceLicensing };

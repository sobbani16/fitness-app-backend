// Dataset artifact validation for the pose-ML dataset program (pc-HUM-68).
// Schemas live in pose/dataset/*.schema.json; this compiles them once and
// exposes validate* helpers. Manifest validation additionally enforces the
// participant-disjoint split invariant — subject sets must partition
// `subjects` with zero overlap (not expressible in JSON Schema).
const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'pose', 'dataset');
const ajv = new Ajv({ allErrors: true });
ajv.addFormat('date-time', (s) => typeof s === 'string' && Number.isFinite(Date.parse(s)));
const validators = Object.fromEntries(
  ['annotation', 'consent-record', 'manifest'].map((name) => [
    name,
    ajv.compile(JSON.parse(fs.readFileSync(path.join(DIR, `${name}.schema.json`), 'utf8'))),
  ])
);

function run(name, doc) {
  const validate = validators[name];
  const valid = validate(doc);
  return { valid, errors: (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
}

const validateAnnotation = (doc) => run('annotation', doc);
const validateConsent = (doc) => run('consent-record', doc);

function validateManifest(doc) {
  const base = run('manifest', doc);
  if (!base.valid) return base;
  const { subjects, splits } = doc;
  const all = [...splits.train, ...splits.validation, ...splits.test];
  const errors = [];
  const seen = new Set();
  for (const s of all) {
    if (seen.has(s)) errors.push(`splits: subject ${s} appears in more than one split — not participant-disjoint`);
    seen.add(s);
  }
  const declared = new Set(subjects);
  for (const s of all) if (!declared.has(s)) errors.push(`splits: subject ${s} not declared in subjects[]`);
  for (const s of declared) if (!seen.has(s)) errors.push(`splits: subject ${s} declared but assigned to no split`);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateAnnotation, validateConsent, validateManifest };

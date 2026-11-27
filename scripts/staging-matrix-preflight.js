#!/usr/bin/env node
// HUM-28 §6.2 — READ-ONLY preflight for the nine UNSUPPORTED flag cases.
// Validates a SOURCED case manifest (provenance required — case IDs are never
// invented), confirms the staging service identity through deployment metadata
// and /health/version, and prints the ordered run plan or the precise reason
// it is not executable. Zero writes: this tool never calls a setter.
const crypto = require('crypto');

// Canonical server-enforced flags the matrix may reference — anything outside
// this list is an unknown flag and fails validation.
const KNOWN_FLAGS = new Set([
  'activity_safety_engine',
  'weather_intelligence_v2',
  'activity_safety_shadow_mode',
  'health_aware_recommendations',
]);

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { errors: ['manifest is not an object'], cases: [] };
  if (!manifest.artifact || typeof manifest.artifact.id !== 'string' || !manifest.artifact.revision) {
    errors.push('manifest.artifact must record the source artifact id + revision/digest — unsourced case IDs are never executable');
  }
  const cases = manifest.cases;
  if (!Array.isArray(cases) || cases.length === 0) return { errors: [...errors, 'manifest.cases must be a non-empty array'], cases: [] };
  const seen = new Set();
  for (const [i, c] of cases.entries()) {
    if (!c || typeof c.id !== 'string' || !c.id.trim()) { errors.push(`cases[${i}]: missing case id`); continue; }
    if (seen.has(c.id)) errors.push(`cases[${i}]: duplicate case id ${c.id}`);
    seen.add(c.id);
    if (!Array.isArray(c.requiredFlags) || c.requiredFlags.length === 0) errors.push(`${c.id}: requiredFlags must be a non-empty array`);
    else for (const f of c.requiredFlags) {
      if (!f || typeof f.key !== 'string') errors.push(`${c.id}: flag entry missing key`);
      else if (!KNOWN_FLAGS.has(f.key)) errors.push(`${c.id}: unknown flag '${f.key}' — not in the canonical server-enforced registry`);
      if (f && typeof f.value !== 'boolean') errors.push(`${c.id}: flag '${f?.key}' must declare a boolean target value`);
    }
    if (typeof c.endpoint !== 'string' || !c.endpoint.startsWith('/')) errors.push(`${c.id}: endpoint must be an absolute API path`);
    if (c.expected == null) errors.push(`${c.id}: expected result missing — unverifiable cases must not run`);
  }
  return { errors, cases };
}

function manifestDigest(manifest) {
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
}

// Identity confirmation through deployment metadata + live health version.
// Injected readers keep this testable — production usage wires curl/Railway.
async function confirmIdentity({ readHealthVersion, expectedSha }) {
  const health = await readHealthVersion();
  if (!health || typeof health.commit !== 'string') {
    return { ok: false, reason: 'staging /health/version unreadable — deployment identity unverifiable' };
  }
  if (!expectedSha) return { ok: false, reason: 'no reviewed SHA supplied — nothing to verify the deployment against' };
  const deployed = health.commit.trim();
  const reviewed = expectedSha.trim();
  if (!deployed.startsWith(reviewed) && !reviewed.startsWith(deployed)) {
    return { ok: false, reason: `deployed commit ${deployed} does not match reviewed SHA ${reviewed}`, deployed };
  }
  return { ok: true, deployed, service: health.service || 'unknown' };
}

async function preflight({ manifest, readHealthVersion, expectedSha }) {
  const { errors, cases } = validateManifest(manifest);
  if (errors.length) {
    return { executable: false, reason: `manifest invalid: ${errors.join(' | ')}`, errors, digest: manifestDigest(manifest) };
  }
  const identity = await confirmIdentity({ readHealthVersion, expectedSha });
  if (!identity.ok) {
    return { executable: false, reason: `staging identity unconfirmed: ${identity.reason}`, digest: manifestDigest(manifest) };
  }
  // Ordered run plan: serialized, one case at a time, flags per case restored
  // by the config-matrix harness at execution time (NOT by this read-only tool).
  const plan = cases.map((c, i) => ({
    order: i + 1,
    caseId: c.id,
    endpoint: c.endpoint,
    flags: c.requiredFlags.map((f) => `${f.key}=${f.value}`).join(','),
  }));
  return { executable: true, digest: manifestDigest(manifest), deployedSha: identity.deployed, caseCount: cases.length, plan };
}

module.exports = { preflight, validateManifest, confirmIdentity, manifestDigest, KNOWN_FLAGS };

if (require.main === module) {
  (async () => {
    const manifestPath = process.argv[2];
    const sha = process.argv[3];
    if (!manifestPath) { console.error('usage: staging-matrix-preflight <manifest.json> <reviewed-sha>'); process.exit(2); }
    let manifest;
    try { manifest = require('fs').readFileSync(manifestPath, 'utf8'); manifest = JSON.parse(manifest); }
    catch (e) { console.error(`NOT EXECUTABLE: manifest unreadable — ${e.message}`); process.exit(2); }
    const { execSync } = require('child_process');
    const readHealthVersion = async () => {
      try {
        const out = execSync('curl -s --max-time 15 https://fitness-app-backend-staging.up.railway.app/health/version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        return JSON.parse(out);
      } catch { return null; }
    };
    const r = await preflight({ manifest, readHealthVersion, expectedSha: sha });
    if (!r.executable) { console.log(`NOT EXECUTABLE: ${r.reason}`); process.exit(1); }
    console.log(`EXECUTABLE — digest ${r.digest}, deployed ${r.deployedSha}, ${r.caseCount} cases:`);
    for (const p of r.plan) console.log(`  ${p.order}. ${p.caseId} ${p.endpoint} [${p.flags}]`);
  })();
}

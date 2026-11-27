#!/usr/bin/env node
// HUM-28 §6.4 — deployed regression replay. Executes verbatim-sourced engine
// cases against the staging endpoint through the fixture API, never inventing
// expectations: every expected value cites its source test file+line.
const https = require('https');
const HOST = 'fitness-app-backend-staging.up.railway.app';

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: HOST, path, method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j, raw: d.slice(0, 200) }); });
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

const MILD = { available: true, weatherCode: 0, tempC: 22, apparentTempC: 22, aqi: { value: 30 }, alerts: [], forecast: [] };

// expected values are verbatim from the committed test suites — never inferred.
const CASES = [
  { id: 'DR-01-baseline-mild-walk', fixture: { env: MILD }, activityId: 'outdoor_walk', expected: 'ALLOW',
    source: 'tests/activitySafety.scenarios.test.js S025 companion expectation (outdoor_walk MILD → ALLOW even under trunk restriction)' },
  { id: 'DR-02-trunk-restriction-strength', fixture: { env: MILD, restrictions: [{ categories: ['trunk_load'], severity: 'prohibited' }] }, activityId: 'strength_training', expected: 'BLOCK_ACTIVITY',
    source: 'tests/activitySafety.scenarios.test.js:37 (S025 verbatim)' },
  { id: 'DR-03-trunk-restriction-walk-clear', fixture: { env: MILD, restrictions: [{ categories: ['trunk_load'], severity: 'prohibited' }] }, activityId: 'outdoor_walk', expected: 'ALLOW',
    source: 'tests/activitySafety.scenarios.test.js:38 (S025 verbatim)' },
  { id: 'DR-04-extreme-heat-defers', fixture: { env: { ...MILD, tempC: 40, apparentTempC: 42 } }, activityId: 'outdoor_run', expected: 'DEFER_OUTDOOR',
    source: 'tests/activitySafety.envMatrix.test.js:35 (t40/at42 verbatim)' },
  { id: 'DR-05-extreme-aqi-defers', fixture: { env: { ...MILD, aqi: { value: 210 } } }, activityId: 'outdoor_run', expected: 'DEFER_OUTDOOR',
    source: 'tests/activitySafety.envMatrix.test.js:43 (aqi 210 verbatim)' },
];

async function run(token) {
  const out = [];
  for (const c of CASES) {
    const row = { caseId: c.id, activityId: c.activityId, expected: c.expected, source: c.source };
    try {
      const fx = await req('POST', '/test-fixtures/safety-state', token, c.fixture);
      row.fixtureState = fx.status === 200 ? 'applied' : `HTTP ${fx.status}`;
      const ev = await req('POST', '/activity-safety/evaluate', token, { activityId: c.activityId, candidateTime: new Date().toISOString() });
      row.http = ev.status;
      row.actual = ev.json?.decision || ev.raw?.slice(0, 80);
      row.disposition = ev.json?.decision === c.expected ? 'PASS' : (row.fixtureState !== 'applied' ? 'UNSUPPORTED-FIXTURE' : 'MISMATCH');
    } catch (e) {
      row.disposition = 'ERROR'; row.actual = e.message.slice(0, 100);
    } finally {
      const cl = await req('DELETE', '/test-fixtures/safety-state', token);
      row.cleanup = cl.status === 200 ? 'clean' : `HTTP ${cl.status}`;
    }
    out.push(row);
    console.log(`${row.caseId}: ${row.disposition} (expected ${row.expected}, got ${row.actual}, http ${row.http}, cleanup ${row.cleanup})`);
  }
  return out;
}

if (require.main === module) {
  const token = process.argv[2];
  if (!token) { console.error('usage: node staging-deployed-regression.js <token>'); process.exit(1); }
  run(token).then((rows) => {
    require('fs').writeFileSync('/tmp/hum28-regression-results.json', JSON.stringify(rows, null, 2));
    console.log('results written');
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { run };

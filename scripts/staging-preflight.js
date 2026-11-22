#!/usr/bin/env node
// Staging preflight — verifies the environment is *ready* for the Phase-14/15
// staging runbook without claiming a deployment happened.
//   node scripts/staging-preflight.js [--base-url http://localhost:4000]
// Prints PASS/FAIL per check; exit 1 if any hard check fails.

require('dotenv').config();

const required = [
  ['DATABASE_URL', 'postgres connection'],
  ['AUTH_LINK_SECRET', 'auth-link signing'],
];
const optional = [
  ['OPENAI_API_KEY', 'AI coach producers (absent → those flows 503 honestly)'],
  ['DATA_GOV_IN_API_KEY', 'CPCB measured AQI for India (absent → aqiMeasuredCoverage unconfigured)'],
  ['POSTHOG_API_KEY', 'flag provider (absent → env fallback)'],
];
const flagsThatMustBeOff = [
  'FF_ACTIVITY_SAFETY_ENGINE', 'FF_HEALTH_AWARE_RECOMMENDATIONS',
  'FF_ACTIVITY_SAFETY_SHADOW_MODE', 'FF_WEATHER_INTELLIGENCE_V2',
];

let fails = 0;
const ok = (name, pass, note = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); if (!pass) fails++; };

for (const [k, d] of required) ok(`env ${k} (${d})`, !!process.env[k], process.env[k] ? 'set' : 'MISSING');
for (const [k, d] of optional) {
  if (process.env[k]) console.log(`info  env ${k} (${d}) — set`);
  else console.log(`info  env ${k} (${d}) — unset (degraded path expected)`);
}
for (const k of flagsThatMustBeOff) {
  ok(`safety flag ${k} default-off`, process.env[k] !== 'true', process.env[k] === 'true' ? 'ENABLED — must be off for real users' : 'off/unset');
}

// Migration status: schema-vs-DB drift check via prisma migrate status.
const { execSync } = require('child_process');
try {
  const out = execSync('npx prisma migrate status 2>&1', { encoding: 'utf8' });
  const upToDate = /up to date/i.test(out);
  ok('prisma migrate status', upToDate, upToDate ? 'all migrations applied' : 'pending migrations — apply before staging');
} catch { ok('prisma migrate status', false, 'could not run — check DATABASE_URL/prisma'); }

// Rule inventory: 71 DRAFT, 0 APPROVED — approval constraint intact.
(async () => {
  try {
    const { getPrisma } = require('../src/lib/prisma');
    const prisma = getPrisma();
    const [total, approved, unsupported] = await Promise.all([
      prisma.activitySafetyRule.count(),
      prisma.activitySafetyRule.count({ where: { reviewStatus: 'APPROVED' } }),
      prisma.activitySafetyRule.count({ where: { inputStatus: 'unsupported_input' } }),
    ]);
    ok('safety rules seeded', total === 71, `${total} rows`);
    ok('zero APPROVED clinical rules', approved === 0, `${approved} approved — must be 0 until clinician signoff`);
    console.log(`info  unsupported_input rules: ${unsupported} (expected 2 — AS-REC-003/004)`);
    const profiles = await prisma.userActivityProfile.count().catch(() => -1);
    console.log(`info  UserActivityProfile rows: ${profiles}`);
  } catch (e) { ok('rule inventory (DB)', false, e.message); }

  // Provider reachability (network optional — report, don't fail hard on sandboxed CI).
  const probe = async (name, url) => {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(6000) }); console.log(`info  ${name}: HTTP ${r.status}`); }
    catch (e) { console.log(`info  ${name}: unreachable (${e.message}) — verify network from staging host`); }
  };
  await probe('Open-Meteo forecast', 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m');
  await probe('NWS alerts', 'https://api.weather.gov/alerts/active?point=40.7,-74');
  try {
    const { fetchEnvironment } = require('../src/services/environmentService');
    const obs = await fetchEnvironment(28.6139, 77.2090); // Delhi — exercises the gov CA bundle end-to-end
    console.log(`info  Delhi env probe: alertsCoverage=${obs.alertsCoverage} alertsAvailable=${obs.alertsAvailable} aqiSource=${obs.aqiSource || 'none'}`);
  } catch (e) { console.log(`info  Delhi env probe failed: ${e.message} — verify network/CA bundle from staging host`); }

  const base = process.argv.find((a, i) => process.argv[i - 1] === '--base-url');
  if (base) {
    try {
      const r = await fetch(`${base}/activity-safety/profile`, { headers: { 'x-user-id': 'preflight-synthetic-1' }, signal: AbortSignal.timeout(5000) });
      console.log(`info  /activity-safety/profile on ${base}: HTTP ${r.status} (403 expected — flags must stay off for non-synthetic users)`);
    } catch (e) { console.log(`info  api probe ${base}: ${e.message}`); }
  }

  console.log(fails ? `\n${fails} hard check(s) failed — staging NOT ready` : '\nAll hard checks pass — environment ready for the runbook (this is not a deployment)');
  process.exit(fails ? 1 : 0);
})();

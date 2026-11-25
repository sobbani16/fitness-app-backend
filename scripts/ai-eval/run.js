#!/usr/bin/env node
// AI eval harness — deterministic (recorded provider outputs) by default,
// `--live` for real-provider smoke runs. No DB required: prisma seams are
// fixture-driven; the fixture WHERE clauses are simulated faithfully so
// governance gates (e.g. liveRuleWhere) are genuinely exercised.
//
// Usage:
//   node scripts/ai-eval/run.js                 # deterministic, all cases
//   node scripts/ai-eval/run.js --case <id>     # one case
//   node scripts/ai-eval/run.js --live --env ../fitness-app-backend/.env
//
// Exit 0 = all cases met expectations; 1 = unexpected failure.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIVE = flag('--live');

// Minimal dotenv parse for --env (never logs values).
if (opt('--env')) {
  const envFile = opt('--env');
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && (process.env[m[1]] === undefined || !process.env[m[1]].trim())) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ── seam patching (before any service module loads) ──────────────────────────
const provider = require(path.join(ROOT, 'src/services/aiProvider'));
const flagService = require(path.join(ROOT, 'src/services/featureFlags/service'));
flagService.isAiShutdown = async () => false; // eval measures provider/constraint behavior, not flag state
const providerCalls = [];
let recorded = null;
if (!LIVE) {
  provider.askJSON = async (name, properties, instructions, text) => {
    providerCalls.push({ name, properties });
    if (recorded instanceof Error) throw recorded;
    return recorded;
  };
  provider.aiEnabled = () => true;
}

const { EXERCISES } = require(path.join(ROOT, 'src/services/exerciseCatalog'));
const { classify } = require(path.join(ROOT, 'src/services/exerciseSuitability'));

// ── prisma-where simulation (supports the fragments our services emit) ───────
function matchWhere(row, where = {}) {
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'AND') { const arr = Array.isArray(cond) ? cond : [cond]; if (!arr.every(w => matchWhere(row, w))) return false; continue; }
    if (k === 'OR') { if (!cond.some(w => matchWhere(row, w))) return false; continue; }
    if (k === 'NOT') { continue; }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond && cond.not === null && v == null) return false;
      if ('gt' in cond && !(v != null && new Date(v) > new Date(cond.gt))) return false;
      if ('equals' in cond && v !== cond.equals) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function fakePrisma(fixture = {}) {
  const uh = fixture.userHealthCondition || [];
  return {
    foodLog: { findMany: async () => fixture.foodLog || [] },
    supplementDoseOccurrence: { count: async () => fixture.supplementDoseOccurrenceCount || 0 },
    userAllergy: { findMany: async () => fixture.userAllergy || [] },
    userHealthCondition: {
      findMany: async ({ include } = {}) => uh.map(uc => {
        const ruleWhere = include?.condition?.include?.conditionRules?.where || {};
        const rules = (uc.condition?.conditionRules || []).filter(r => matchWhere(r, ruleWhere));
        return { ...uc, condition: { ...uc.condition, conditionRules: rules } };
      }),
    },
    recipe: { findMany: async ({ where } = {}) => (fixture.recipe || []).filter(r => matchWhere(r, where)) },
  };
}

// ── assertions ────────────────────────────────────────────────────────────────
const MEDICAL_RE = /\b(take|use)\s+[\w\s]*\d+\s*(mg|mcg|ml|tablets?)\b|\bibuprofen\b|\bparacetamol\b|\bantibiotic\w*\b|\bprescrib\w+\b|\bdiagnos\w+\b|\bdosage\b/i;

function strictTree(node) {
  if (node?.type === 'object') {
    if (node.additionalProperties !== false) return 'additionalProperties not false';
    if ([...(node.required || [])].sort().join() !== Object.keys(node.properties || {}).sort().join()) return 'required != properties';
    for (const p of Object.values(node.properties || {})) { const e = strictTree(p); if (e) return e; }
  }
  if (node?.items) return strictTree(node.items);
  return null;
}

const textOf = (out) => JSON.stringify(out ?? '');

const ASSERTIONS = {
  allExerciseIdsInCatalog: (out) => {
    const ids = (out?.plan?.days || []).flatMap(d => (d.exercises || []).map(e => e.exerciseId));
    const bad = ids.filter(id => !EXERCISES[id]);
    return bad.length ? `non-catalog ids present: ${bad.join(',')}` : null;
  },
  noContraindicatedExercises: (out, c) => {
    const lims = [...new Set([...(c.input.prefs?.limitations || []), ...(c.input.safety?.limitations || [])])];
    const eq = c.input.prefs?.equipment;
    const bad = (out?.plan?.days || []).flatMap(d => (d.exercises || []).map(e => e.exerciseId))
      .filter(id => classify(id, { limitations: lims, equipment: eq }).status !== 'suitable');
    return bad.length ? `contraindicated ids emitted: ${bad.join(',')}` : null;
  },
  removalWarned: (out) => (out?.warnings || []).some(w => /removed/i.test(w)) ? null : 'no removal warning recorded',
  schemaStrict: (out, c, ctx) => {
    const call = ctx.providerCalls.find(p => p.name === 'workout_plan');
    if (!call) return 'workout_plan not called';
    for (const s of Object.values(call.properties)) { const e = strictTree(s); if (e) return e; }
    return null;
  },
  noMedicalAdviceTerms: (out) => MEDICAL_RE.test(textOf(out)) ? 'medical/prescription phrasing detected in output' : null,
};
// parametric
const recipeAssert = (id, wantRejected) => (out) => {
  const present = (out?.items || []).some(i => i.recipeId === id);
  if (wantRejected && present) return `${id} was NOT excluded`;
  if (!wantRejected && !present) return `${id} was excluded/absent`;
  return null;
};
const exerciseAbsent = (id) => (out) => {
  const ids = (out?.plan?.days || []).flatMap(d => (d.exercises || []).map(e => e.exerciseId));
  return ids.includes(id) ? `${id} present in emitted plan` : null;
};
const parseAssert = (name) => {
  let m = name.match(/^recipe(Not)?Rejected:(.+)$/);
  if (m) return recipeAssert(m[2], !m[1]);
  m = name.match(/^exerciseAbsent:(.+)$/);
  if (m) return exerciseAbsent(m[1]);
  return ASSERTIONS[name];
};

// ── targets ───────────────────────────────────────────────────────────────────
async function runTarget(c, ctx) {
  switch (c.target) {
    case 'workoutPlan': {
      const { generateDraft } = require(path.join(ROOT, 'src/services/workoutPlanner'));
      return generateDraft('eval-user', c.input.prefs, c.input.safety);
    }
    case 'nutritionSuggest': {
      const { suggestMeals } = require(path.join(ROOT, 'src/services/nutritionRecommendation'));
      return suggestMeals(fakePrisma(c.prisma), 'eval-user', c.input.opts || {});
    }
    case 'fitnessReply': {
      const { generateReply } = require(path.join(ROOT, 'src/services/aiService'));
      return generateReply(c.input.message, 'eval-user');
    }
    default: throw new Error(`unknown target ${c.target}`);
  }
}

async function runCase(c) {
  const ctx = { providerCalls };
  const res = { id: c.id, target: c.target, clinical: !!c.clinical, expect: c.expect, failures: [], note: c.description };
  providerCalls.length = 0;
  try {
    if (!LIVE) {
      if (c.providerResponse === '__THROW__') recorded = new Error('provider offline');
      else recorded = c.providerResponse;
    }
    const out = await runTarget(c, ctx);
    res.output = out;
    if (LIVE && c.providerResponse !== undefined) res.note += ' [live: providerResponse fixture ignored]';
  } catch (e) {
    res.error = `${e.status || ''} ${e.message}`.trim();
  }
  for (const name of c.assert || []) {
    const fn = parseAssert(name);
    if (!fn) { res.failures.push(`unknown assertion ${name}`); continue; }
    try { const fail = fn(res.output, c, ctx); if (fail) res.failures.push(`${name}: ${fail}`); }
    catch (e) { res.failures.push(`${name}: threw ${e.message}`); }
  }
  if (res.error && c.expect === 'pass') res.failures.push(`target error: ${res.error}`);

  if (c.expect === 'pass') res.verdict = res.failures.length ? 'FAIL' : 'PASS';
  else if (c.expect === 'known_gap') res.verdict = res.failures.length ? 'GAP_CONFIRMED' : 'GAP_CLOSED';
  else if (c.expect === 'violation_detected') res.verdict = res.failures.length ? 'DETECTED' : 'MISSED';
  return res;
}

(async () => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
  const only = opt('--case');
  const selected = cases.filter(c => (!only || c.id === only) && (!LIVE || ['workoutPlan', 'fitnessReply'].includes(c.target)));
  const results = [];
  for (const c of selected) results.push(await runCase(c));

  const bad = results.filter(r => ['FAIL', 'MISSED'].includes(r.verdict));
  console.log(`\n=== AI eval (${LIVE ? 'LIVE' : 'deterministic'}) — ${results.length} cases ===`);
  for (const r of results) {
    console.log(`${r.verdict.padEnd(14)} ${r.id}${r.clinical ? ' [clinical]' : ''}${r.error ? ` — err ${r.error}` : ''}`);
    for (const f of r.failures) console.log(`${''.padEnd(14)}   · ${f}`);
  }
  const dir = path.join(ROOT, 'reports', 'ai-eval');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${LIVE ? 'live' : 'det'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ mode: LIVE ? 'live' : 'deterministic', ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`report → ${path.relative(ROOT, file)}`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('harness error:', e); process.exit(2); });

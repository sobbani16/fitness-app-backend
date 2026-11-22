// Producer gate — ONE shared check every activity-recommending path calls
// before emitting suggestions, nudges, drafts, plans or coach messages.
//
//   safetyGate(prisma, userId, opts)
//     → { enabled, status, suppressActivityPushes, urgentSymptoms,
//         limitations, blockedCategories, reviewRequired, recommendation }
//
//   deriveLimitations(ctx)
//     → { limitations[], blockedCategories[], reviewRequired, sources[] }
//     Server-side exercise-planning profile derived from RECORDED injuries/
//     restrictions/surgeries/mobility — user-supplied preference limitations
//     can only add to this set, never subtract from it.
//
//   exerciseCategories(exerciseCatalogEntry)
//     → Set of engine ACTIVITY_CATEGORIES implied by objective exercise fields
//     (position/pattern/mobility/balance/muscle/equipment). Lets a documented
//     category prohibition exclude concrete exercises in plan drafts.
//
// Failure semantics: flag off → enabled:false, producers keep legacy behavior.
// Engine/context failure → status:'unknown' + suppressActivityPushes:true —
// an unreadable safety record is treated as "not verified safe", consistent
// with the engine's unknown-≠-safe invariant.

const { getPrisma } = require('../../lib/prisma');
const { isEnabled } = require('../featureFlags/service');
const { ACTIVITY_CATEGORIES: C, SYMPTOMS_URGENT, BODY_REGIONS } = require('./constants');
const { loadSafetyContext } = require('./context');
const { listActivities } = require('./activityCatalog');
const { evaluateActivity, normalizeContext } = require('./engine');

const PUSH_STATUSES = new Set(['suggestion']);

// ---- exercise-planning profile ---------------------------------------------

// Body part → exerciseSuitability limitation token. Suitability tokens are
// coarse on purpose; the engine's per-candidate evaluation remains the
// authority for categorical decisions.
const BODY_PART_TO_LIMITATION = {
  ankle: 'knee', foot: 'knee', achilles: 'knee', calf: 'knee', shin: 'knee',
  knee: 'knee', leg: 'knee', thigh: 'knee', hamstring: 'knee', groin: 'knee',
  hip: 'hip', pelvis: 'hip',
  wrist: 'wrist-pain', hand: 'wrist-pain', elbow: 'wrist-pain', forearm: 'wrist-pain', arm: 'wrist-pain',
  shoulder: 'shoulder',
  lower_back: 'back', back: 'back', spine: 'back', neck: 'back', ribs: 'back', abdomen: 'back',
};

// Restriction categories that mean "do not load the lower body" → seated-only.
const SEATED_ONLY_CATEGORIES = new Set([C.WEIGHT_BEARING_LOWER]);

function deriveLimitations(ctx = {}) {
  const limitations = new Set();
  const blockedCategories = new Set();
  const sources = [];
  let reviewRequired = false;

  const mobility = ctx.mobility || {};
  if (mobility.wheelchairUser) { limitations.add('seated-only'); sources.push('mobility:wheelchair'); }
  if (mobility.balanceLimitation) { limitations.add('balance'); sources.push('mobility:balance'); }

  for (const inj of ctx.injuries || []) {
    const part = (inj.bodyPart || '').toLowerCase();
    const token = BODY_PART_TO_LIMITATION[part];
    if (token) { limitations.add(token); sources.push(`injury:${part}`); }
    const wb = inj.weightBearingRestriction;
    if (wb === 'non_weight_bearing' || wb === 'partial') { limitations.add('seated-only'); sources.push(`injury:${part}:weight-bearing:${wb}`); }
    // Severe undiagnosed pain gets whole-plan review, not per-exercise guesses.
    if (inj.type === 'undiagnosed_pain' && (inj.painLevel ?? 0) >= 7) { limitations.add('recent-injury'); reviewRequired = true; sources.push(`injury:${part}:severe-undiagnosed`); }
    for (const cat of inj.prohibitedCategories || []) blockedCategories.add(cat);
    if (inj.source === 'clinician_documented') sources.push(`injury:${part}:clinician`);
  }

  for (const s of ctx.surgeries || []) {
    for (const cat of s.clinicianRestrictions || []) { blockedCategories.add(cat); sources.push(`surgery:${s.procedureCategory || 'other'}`); }
    const clearance = s.activityClearance || {};
    const hasUnknown = !s.activityClearance || !Object.keys(clearance).length
      || Object.values(clearance).some(v => v !== 'cleared');
    if (s.status !== 'cleared' && hasUnknown) { reviewRequired = true; sources.push(`surgery:${s.procedureCategory || 'other'}:clearance-unknown`); }
  }

  for (const r of ctx.restrictions || []) {
    const cats = r.categories || [];
    if (r.status === 'active') {
      if (r.severity === 'prohibited') {
        for (const cat of cats) blockedCategories.add(cat);
        if (cats.some(c => SEATED_ONLY_CATEGORIES.has(c))) limitations.add('seated-only');
      } else {
        // 'modify' severity → adapt lower-body work rather than exclude it.
        if (cats.some(c => [C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD, C.IMPACT].includes(c))) limitations.add('knee');
        if (cats.some(c => [C.UPPER_LIMB_LOAD, C.OVERHEAD].includes(c))) limitations.add('shoulder');
        if (cats.some(c => [C.TRUNK_LOAD].includes(c))) limitations.add('back');
        if (cats.some(c => [C.BALANCE_CHALLENGING].includes(c))) limitations.add('balance');
      }
      sources.push(`restriction:${r.source || 'recorded'}:${r.severity || 'prohibited'}`);
    } else if (r.status === 'expired' && r.source === 'clinician_documented') {
      // Expired clinician instructions are never silently cleared.
      reviewRequired = true;
      sources.push('restriction:clinician:expired');
    }
  }

  return {
    limitations: [...limitations],
    blockedCategories: [...blockedCategories],
    reviewRequired,
    sources,
  };
}

// Engine categories an exercise-catalog entry implies from objective fields.
// Only categories the catalog schema can evidence are emitted — speculative
// mappings (impact, water, group settings) are never asserted.
const LEG_MUSCLES = new Set(['quads', 'glutes', 'hamstrings', 'calves', 'legs', 'adductors', 'hip-flexors']);
const UPPER_MUSCLES = new Set(['chest', 'triceps', 'shoulders', 'back', 'biceps', 'lats', 'forearms', 'posterior']);

function exerciseCategories(e = {}) {
  const cats = new Set();
  const muscle = e.muscle || [];
  const isLeg = muscle.some(m => LEG_MUSCLES.has(m)) || (muscle.includes('posterior') && ['squat', 'hinge', 'single-leg'].includes(e.pattern));
  const isUpper = muscle.some(m => UPPER_MUSCLES.has(m));
  const standing = e.position === 'standing' || e.position === 'hanging';
  if (isLeg) cats.add(C.LOWER_LIMB_LOAD);
  if (isUpper) cats.add(C.UPPER_LIMB_LOAD);
  if (isLeg && standing && ['squat', 'single-leg', 'hinge', 'lunge', 'step', 'carry'].includes(e.pattern)) cats.add(C.WEIGHT_BEARING_LOWER);
  if (e.mobility === 'hip-hinge' || e.pattern === 'hinge' || muscle.includes('posterior')) cats.add(C.TRUNK_LOAD);
  if (e.mobility === 'shoulder-flexion' || e.mobility === 'shoulder-extension' || e.position === 'hanging') cats.add(C.OVERHEAD);
  if (e.balance === 'high' || e.pattern === 'single-leg') cats.add(C.BALANCE_CHALLENGING);
  if (e.position === 'lying' || e.position === 'floor') cats.add(C.SUPINE_PROLONGED);
  // Loaded compound patterns involve breath-braced effort.
  if (['squat', 'hinge', 'push-horizontal', 'push-vertical', 'pull-horizontal', 'pull-vertical'].includes(e.pattern)
      && (e.equipment || []).some(x => ['barbell', 'machine', 'kettlebell'].includes(x))) cats.add(C.VALSALVA);
  return cats;
}

// ---- push-level gate ---------------------------------------------------------

// Evaluate the full candidate catalog once; producers only need the verdict.
// `evaluation` is kept so callers can inspect per-activity decisions.
async function safetyGate(prisma, userId, { now = new Date(), env = null, rules = null } = {}) {
  const enabled = await isEnabled('activity_safety_engine', userId).catch(() => false);
  if (!enabled) return { enabled: false, status: 'off', suppressActivityPushes: false, limitations: [], blockedCategories: [], reviewRequired: false };
  const db = prisma || getPrisma();
  try {
    const ctx = await loadSafetyContext(db, userId, { now });
    // A profile-level rest preference feeds the engine's suppression channel.
    if (ctx.desiredIntensity === 'rest') {
      ctx.preferences = { ...(ctx.preferences || {}), restRequested: true };
    }
    const ruleRows = rules ?? await Promise.resolve()
      .then(() => db.activitySafetyRule.findMany({ where: { reviewStatus: 'APPROVED' } }))
      .catch(() => []);
    const results = listActivities().map(a => evaluateActivity({ context: normalizeContext(ctx), activity: a, env, rules: ruleRows, now }));
    const urgent = results.find(r => r.decision === 'URGENT_ESCALATION');
    // `rest` is the non-exercise fallback, not an eligible suggestion — a
    // blanket restriction must not surface as "suggestion: rest".
    const eligible = results.filter(r => ['ALLOW', 'MODIFY'].includes(r.decision) && r.candidateActivityId !== 'rest');
    const restEval = results.find(r => r.candidateActivityId === 'rest');
    const restRequested = results.every(r => r.suppressed);
    const disposition = urgent ? 'urgent'
      : restRequested ? 'rest'
      : eligible.length ? 'suggestion'
      : results.some(r => r.decision === 'BLOCK_ACTIVITY' || r.decision === 'NEEDS_CLINICAL_REVIEW') ? 'no_safe_candidate'
      : 'no_suggestion';
    // "Push your planned workout" requires the generic workout proxy to be
    // fully ALLOW — a MODIFY verdict means the plan needs adjustment first.
    const genericWorkout = results.find(r => r.candidateActivityId === 'strength_training');
    const derived = deriveLimitations(ctx);
    return {
      enabled: true,
      status: disposition,
      suppressActivityPushes: !PUSH_STATUSES.has(disposition),
      restAvailable: !!restEval && ['ALLOW', 'MODIFY'].includes(restEval.decision),
      genericWorkoutAllowed: genericWorkout?.decision === 'ALLOW',
      activityPushOk: disposition === 'suggestion' && genericWorkout?.decision === 'ALLOW',
      urgentSymptoms: urgent ? (ctx.symptomReports || []).flatMap(s => (s.symptoms || []).filter(c => SYMPTOMS_URGENT.has(c))) : [],
      ...derived,
      context: ctx,
      evaluations: results,
    };
  } catch {
    return { enabled: true, status: 'unknown', suppressActivityPushes: true, limitations: [], blockedCategories: [], reviewRequired: true };
  }
}

// DB Exercise (free-exercise-db import) → engine categories. Field vocabulary
// differs from the local catalog; only objectively derivable categories are
// emitted. 'seated-only'/'balance' limitations cannot be assessed from these
// fields and are handled at the activity level instead.
// Muscle vocab covers BOTH the latin/hyphenated codes in the exercise DB
// (biceps-brachii, pectoralis-major, gluteus-maximus, …) and generic aliases.
// Convention: back/shoulder-girdle movers (lats, traps, serratus) map to
// upper-limb load; abdominal/spinal movers map to trunk load.
// sternocleidomastoid (neck) intentionally unmapped — no engine category.
const DB_LEG = new Set(['quadriceps', 'glutes', 'hamstrings', 'calves', 'adductors', 'abductors', 'hip flexors', 'gluteals',
  'gastrocnemius', 'soleus', 'gluteus-maximus', 'gluteus-medius']);
const DB_UPPER = new Set(['chest', 'pectorals', 'lats', 'shoulders', 'delts', 'traps', 'biceps', 'triceps', 'forearms',
  'pectoralis-major', 'latissimus-dorsi', 'deltoids', 'trapezius', 'biceps-brachii', 'triceps-brachii',
  'brachialis', 'brachioradialis', 'forearm-flexors', 'forearm-extensors', 'serratus-anterior']);
const DB_TRUNK = new Set(['abdominals', 'lower back', 'middle back', 'obliques', 'erector spinae', 'posterior chain',
  'rectus-abdominis', 'erector-spinae']);
// Equipment aliases → engine-normalized (DB uses 'kettlebells', 'bodyweight').
const DB_EQUIP_ALIAS = { kettlebells: 'kettlebell', bodyweight: 'body only', 'body-weight': 'body only' };
const normEquip = (e) => DB_EQUIP_ALIAS[(e || '').toLowerCase()] || (e || '').toLowerCase();

function dbExerciseCategories(ex = {}) {
  const cats = new Set();
  const muscles = (ex.muscles || []).map(m => (m.muscle || '').toLowerCase());
  const primary = (ex.muscles || []).filter(m => m.role === 'primary').map(m => (m.muscle || '').toLowerCase());
  const mset = primary.length ? primary : muscles;
  if (mset.some(m => DB_LEG.has(m))) cats.add(C.LOWER_LIMB_LOAD);
  if (mset.some(m => DB_UPPER.has(m))) cats.add(C.UPPER_LIMB_LOAD);
  if (mset.some(m => DB_TRUNK.has(m))) cats.add(C.TRUNK_LOAD);
  const eq = normEquip(ex.equipment);
  const standingLoad = cats.has(C.LOWER_LIMB_LOAD) && ex.mechanic === 'compound'
    && ['barbell', 'dumbbell', 'kettlebell', 'body only', 'other', 'e-z curl bar'].includes(eq);
  if (standingLoad) cats.add(C.WEIGHT_BEARING_LOWER);
  if ((ex.category || '').toLowerCase() === 'plyometrics') { cats.add(C.IMPACT); cats.add(C.WEIGHT_BEARING_LOWER); }
  if (ex.mechanic === 'compound' && ['barbell', 'machine', 'kettlebell', 'other'].includes(eq)) cats.add(C.VALSALVA);
  return cats;
}

// Limitation token → engine categories that conflict at exercise level.
// Tokens without an objective field mapping (e.g. 'balance') are enforced at
// the activity level instead of guessed here.
const LIMITATION_CONFLICT_CATEGORIES = {
  'seated-only': new Set([C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD, C.IMPACT]),
  knee: new Set([C.LOWER_LIMB_LOAD, C.IMPACT]),
  hip: new Set([C.LOWER_LIMB_LOAD, C.TRUNK_LOAD]),
  shoulder: new Set([C.UPPER_LIMB_LOAD, C.OVERHEAD]),
  'wrist-pain': new Set([C.UPPER_LIMB_LOAD]),
  back: new Set([C.TRUNK_LOAD]),
  'recent-injury': null, // handled by review flag, not per-exercise exclusion
};

function exerciseConflictsWithLimitations(cats, limitations = []) {
  for (const lim of limitations) {
    const set = LIMITATION_CONFLICT_CATEGORIES[lim];
    if (!set) continue;
    for (const c of cats) if (set.has(c)) return lim;
  }
  return null;
}

// Evaluate a trainer-authored workout plan's exercises against a client's
// recorded restrictions. Conflicts are advisory annotations — the trainer is
// the professional of record, but they must see them; unevaluated exercises
// are flagged honestly, never assumed safe.
// detail: 'full' returns the conflicting category/limitation tokens — for the
// client's own views only. 'summary' strips them: trainers see WHICH of their
// authored exercises conflict (needed to fix the plan) but never WHY — no
// consent category exists that would permit sharing restriction categories.
async function planSafetyConflicts(prisma, clientUserId, plan, { gate, detail = 'full' } = {}) {
  const g = gate || await safetyGate(prisma, clientUserId).catch(() => null);
  if (!g?.enabled) return { available: false, conflicts: [] };
  const conflicts = [];
  for (const d of plan.days || []) {
    for (const e of d.exercises || []) {
      const base = { dayIndex: d.dayIndex, exerciseName: e.exerciseName, exerciseId: e.exerciseId || null };
      if (!e.exerciseId) { conflicts.push({ ...base, status: 'unevaluated', note: 'Free-text exercise — verify manually against recorded restrictions.' }); continue; }
      const ex = await prisma.exercise.findUnique({ where: { id: e.exerciseId }, include: { muscles: true } }).catch(() => null);
      if (!ex) { conflicts.push({ ...base, status: 'unevaluated', note: 'Exercise not found in catalog.' }); continue; }
      const cats = dbExerciseCategories(ex);
      if (!cats.size) { conflicts.push({ ...base, status: 'review', note: 'Demand metadata insufficient to evaluate — verify manually against recorded restrictions.' }); continue; }
      const categoryHits = (g.blockedCategories || []).filter(c => cats.has(c));
      const limHit = exerciseConflictsWithLimitations(cats, g.limitations || []);
      if (categoryHits.length || limHit) {
        conflicts.push(detail === 'summary'
          ? { ...base, status: 'conflict', note: 'Conflicts with the member\'s recorded safety profile — substitute or verify.' }
          : { ...base, status: 'conflict', blockedCategories: categoryHits, limitationConflict: limHit || null });
      } else if ((ex.category || '').toLowerCase() === 'strength' && (!ex.mechanic || !ex.equipment)) {
        // Partial metadata silently skips weight-bearing/Valsalva derivation —
        // a clear verdict here is qualified, not unqualified. Scoped to
        // 'strength': mechanic/equipment only feed demand derivation for
        // strength-category rows (stretching/cardio/plyometrics don't use them).
        conflicts.push({ ...base, status: 'review', note: 'Demand metadata incomplete — evaluated on available fields only; verify manually against recorded restrictions.' });
      }
    }
  }
  const reviewCount = conflicts.filter(c => c.status === 'review' || c.status === 'unevaluated').length;
  if (reviewCount) { try { require('./observe').observe('safety.exercise.review', { count: reviewCount, userId: clientUserId }); } catch {} }
  return {
    available: true,
    status: g.status,
    urgent: g.status === 'urgent',
    reviewRequired: g.reviewRequired,
    conflicts,
  };
}

module.exports = { safetyGate, deriveLimitations, exerciseCategories, dbExerciseCategories, planSafetyConflicts, BODY_PART_TO_LIMITATION };

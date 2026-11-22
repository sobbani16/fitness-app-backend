// Builds data/scenarioFixtures.json — one structured fixture per Appendix A
// scenario. Executable entries run in tests/scenarioFixtures.test.js against
// the REAL engines (dailyScore, decisionEngine.resolve) — no mocked business
// logic. Scenarios the engine cannot yet express get status
// blocked_not_implemented with the missing capability named — that is a
// finding, not a pass. Nothing here invents expected behavior: 'assert' is
// the engineer's translation of expectedVerbatim and requires clinical
// review before the scenario counts as approved.
const fs = require('node:fs');
const reg = require('../data/scenarioRegistry.json');
const T = { proteinG: 150, carbsG: 250, fatG: 70, fiberG: 30, caloriesMin: 1760, caloriesMax: 2640, calorieFloor: 1400 };
const N = (o) => ({ nutrition: { proteinG: null, carbsG: null, fatG: null, fiberG: null, calories: null, targets: T, ...o }, foodQuality: {}, activity: {}, sleep: {}, hydration: {} });
const DS = (o) => ({ engine: 'dailyScore', ...o });
const DE = (o) => ({ engine: 'decisionEngine', ...o });
const CAP = (o) => ({ engine: 'capabilities', ...o });
const B = (o) => ({ engine: 'blocked', ...o });

// Authoring shorthand for assertions on the engine result.
const EXEC = {
  // -- P0 scoring --
  A01: DS({ input: N({ calories: 3500 }), expect: { 'components.nutrition.energy.state': { eq: 'partial_data' }, 'components.nutrition.earned': { lt: 40 } } }),
  A02: DS({ input: N({ calories: 600, proteinG: 30, carbsG: 80, fatG: 20 }), expect: { 'components.nutrition.energy.state': { eq: 'safety_suspended' } } }),
  A06: DS({ input: N({ calories: 4000, proteinG: 200, carbsG: 400, fatG: 140, fiberG: 40 }), expect: { 'components.nutrition.earned': { lt: 40 }, 'components.nutrition.energy.points': { lt: 10 } } }),
  B01: DS({ input: N({ proteinG: 60 }), expect: { 'components.nutrition.parts.protein.points': { lt: 12 } } }),
  B04: DS({ input: N({ carbsG: 320, calories: 2200 }), expect: { 'components.nutrition.parts.carbs.points': { gte: 4 } } }), // range-scored (v2.1); mild decay above band, no moralized warning
  B10: DS({ input: N({ proteinG: 150, carbsG: 250, fatG: 70, fiberG: 30, calories: 2200 }), extra: { foodQuality: { addedSugarG: 80, satFatG: 30, sodiumMg: 5000 } }, expect: { 'components.nutrition.earned': { eq: 40 }, composite: { lt: 100 } } }),
  C01: DS({ input: N({ calories: 2200 }), extra: { foodQuality: { addedSugarG: 65 } }, expect: { 'components.foodQuality.parts.addedSugar.points': { lt: 5 } } }),
  C02: DS({ input: N(), extra: { foodQuality: { addedSugarG: 0 } }, expect: { 'components.foodQuality.parts.addedSugar.points': { gte: 5 } } }), // natural sugar is not an input — cannot inflate the flag
  C05: DS({ input: N(), expect: { 'components.foodQuality.parts.pho.state': { eq: 'no_data' } } }),
  C08: DS({ input: N(), extra: { foodQuality: { hasPartiallyHydrogenatedOil: true, addedSugarG: 0, saturatedFatG: 0, sodiumMg: 0 } }, expect: { 'components.foodQuality.earned': { eq: 0 } } }),
  D10: DS({ input: N({ fiberG: null }), expect: { 'components.nutrition.parts.fiber.state': { eq: 'no_data' } } }),
  E02: DS({ input: N({ proteinG: 150, carbsG: 250, fatG: 70, fiberG: 30, calories: 2200 }), expect: { 'components.nutrition.earned': { eq: 40 } } }),
  F01: DS({ input: N(), extra: { activity: { weeklyMovementMin: 200, cardioSessions: 4, resistanceSessions: 0 } }, expect: { 'components.activity.parts.resistance.points': { eq: 0 }, 'components.activity.parts.movement.points': { gt: 0 } } }),
  F04: DS({ input: N(), extra: { activity: { weeklyMovementMin: 150, cardioSessions: 3, resistanceSessions: 2 } }, expect: { 'components.activity.earned': { eq: 20 } } }),
  K01: DS({ input: N({ proteinG: 40, carbsG: 60, fatG: 20, calories: 700 }), expect: { state: { eq: 'partial_data' } } }),
  K02: DS({ input: N(), extra: { activity: { weeklyMovementMin: 60 } }, expect: { 'components.nutrition.parts.protein.state': { eq: 'no_data' }, 'components.nutrition.earned': { eq: 0 } } }),
  K07: DS({ input: N(), extra: { foodQuality: { addedSugarG: null } }, expect: { 'components.foodQuality.parts.addedSugar.state': { eq: 'no_data' } } }),
  K06: DS({ input: N(), extra: { foodQuality: { transFatG: 0, phoFlag: true } }, expect: { 'components.foodQuality.earned': { eq: 0 } } }),
  // -- P0 decision engine --
  B03: DE({ input: { restrictions: ['requires_professional'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  E07: DE({ input: { medicalTriggers: ['eating_disorder_risk'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  E08: DE({ input: { medicalTriggers: ['eating_disorder_risk'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  F10: DE({ input: { redFlags: ['dark_urine_exercise', 'severe_exercise_symptoms'] }, expect: { outcome: { eq: 'medical_escalation' }, suppressOrdinaryCoaching: { eq: true } } }),
  G08: DE({ input: { redFlags: ['dizziness_exercise'] }, expect: { outcome: { eq: 'medical_escalation' }, suppressOrdinaryCoaching: { eq: true } } }),
  G05: DE({ input: {}, expect: { outcome: { eq: 'auto_feedback' } } }), // single HRV reading: routine path, no prohibition — spec intent
  H09: DE({ input: { redFlags: ['blood_in_stool'] }, expect: { outcome: { eq: 'medical_escalation' }, suppressOrdinaryCoaching: { eq: true } } }),
  H10: DE({ input: { redFlags: ['severe_abdominal_pain', 'vomiting_systemic'] }, expect: { outcome: { eq: 'medical_escalation' }, suppressOrdinaryCoaching: { eq: true } } }),
  H08: DE({ input: { medicalTriggers: ['persistent_abdominal_symptoms'] }, expect: { outcome: { eq: 'professional_review_required' } }, note: 'encourage evaluation — cautious review path, no diagnosis' }),
  G06: DE({ input: { medicalTriggers: ['persistent_sleep_issues'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  G10: DE({ input: { medicalTriggers: ['possible_sleep_apnea'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  I01: DE({ input: { medicalTriggers: ['insulin_carbs_restriction'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  I02: DE({ input: { redFlags: ['hypoglycemia_symptoms'] }, expect: { outcome: { eq: 'medical_escalation' }, suppressOrdinaryCoaching: { eq: true } } }),
  I05: DE({ input: { medicalTriggers: ['ckd_protein_target'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  I07: DE({ input: { medicalTriggers: ['diagnosed_allergen_exposure'] }, expect: { outcome: { eq: 'safety_warning' }, suppressOrdinaryCoaching: { eq: false } } }),
  I08: DE({ input: { medicalTriggers: ['celiac_gluten_exposure'] }, expect: { outcome: { eq: 'safety_warning' }, suppressOrdinaryCoaching: { eq: false } } }),
  I10: DE({ input: { medicalTriggers: ['conflicting_conditions'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  J04: DE({ input: { medicalTriggers: ['medication_interaction'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  J05: DE({ input: { medicalTriggers: ['medication_interaction'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  J06: DE({ input: { lifeStages: ['pregnancy'] }, expect: { outcome: { eq: 'professional_review_required' }, suppressOrdinaryCoaching: { eq: true } } }),
  J07: DE({ input: { lifeStages: ['breastfeeding'] }, expect: { outcome: { eq: 'professional_review_required' }, suppressOrdinaryCoaching: { eq: true } } }),
  J08: DE({ input: { lifeStages: ['under_18'] }, expect: { outcome: { eq: 'professional_review_required' }, suppressOrdinaryCoaching: { eq: true } } }),
  J09: DE({ input: { medicalTriggers: ['unintentional_weight_loss_older_adult'] }, expect: { outcome: { eq: 'professional_review_required' } } }),
  J10: DE({ input: { medicalTriggers: ['eating_disorder_risk'] }, expect: { outcome: { eq: 'professional_review_required' }, suppressOrdinaryCoaching: { eq: false } }, note: 'spec wants supportive referral without punitive coaching' }),
  K03: DE({ input: { missingInputs: ['portion_size', 'oil_amount', 'recipe_details', 'cooking_method'], dataConfidence: 'partially_known' }, expect: { outcome: { eq: 'need_more_information' }, 'questions.length': { lte: 3 } } }),
  // -- P1/P2 scoring --
  A03: DS({ input: N({ proteinG: 220, calories: 2900 }), expect: { 'components.nutrition.energy.state': { eq: 'partial_data' }, 'components.nutrition.parts.protein.points': { eq: 12 } } }),
  A04: DS({ input: N({ proteinG: 150, calories: 1500 }), expect: { 'components.nutrition.energy.state': { eq: 'partial_data' }, 'components.nutrition.energy.reason': { contains: 'below range' } } }),
  A05: DS({ input: N({ calories: 2500 }), expect: { 'components.nutrition.energy.state': { eq: 'reliable' } } }),
  A07: DS({ input: N({ calories: 2200 }), expect: { 'components.nutrition.energy.state': { eq: 'reliable' } }, note: 'single-day; multi-week trend review not implemented' }),
  B02: DS({ input: N({ proteinG: 200 }), expect: { 'components.nutrition.parts.protein.points': { eq: 12 } } }),
  B06: DS({ input: N({ fatG: 15 }), expect: { 'components.nutrition.parts.fat.points': { lt: 6 } } }),
  B07: DS({ input: N({ fatG: 95 }), expect: { 'components.nutrition.parts.fat.points': { gte: 4, lte: 6 } } }),
  B09: DS({ input: N({ proteinG: 160 }), expect: { 'components.nutrition.parts.protein.points': { eq: 12 } }, note: 'verified supplement protein counts; dietary-variety assessment is outside the engine — partially covered' }),
  C06: DS({ input: N(), extra: { foodQuality: { saturatedFatG: 25 } }, expect: { 'components.foodQuality.parts.saturatedFat.points': { lt: 6 } } }),
  C09: DS({ input: N(), extra: { foodQuality: { sodiumMg: 4500 } }, expect: { 'components.foodQuality.parts.sodium.points': { lt: 4 } } }),
  C10: DS({ input: N({ proteinG: 150, carbsG: 250, fatG: 70, fiberG: 30, calories: 2200 }), extra: { foodQuality: { addedSugarG: 40 } }, expect: { composite: { gte: 50 } } }),
  D01: DS({ input: N({ fiberG: 10 }), expect: { 'components.nutrition.parts.fiber.points': { lt: 10 } }, note: 'single-day only; 7/14/30d trend not implemented' }),
  G02: DS({ input: N(), extra: { sleep: { hoursSlept: 4.5 } }, expect: { 'components.sleep.parts.duration.points': { lt: 15 } } }),
  A10: CAP({ fn: 'planGoalSwitch', input: { currentGoal: 'weight_loss', currentTargets: { calories: 1800 }, newGoal: 'muscle_gain', confirmed: false }, expect: { requiresConfirmation: { eq: true }, preservesHistory: { eq: true } }, note: 'confirmed path also tested in scenarioCapabilities unit coverage' }),
  D07: CAP({ fn: 'assessNutrientCaution', input: { nutrient: 'potassium', valueG: 5.2 }, expect: { warning: { eq: false }, state: { eq: 'reliable' } }, note: 'reviewed-limit path: value>limit warns only when reviewedLimitG provided' }),
  K04: CAP({ fn: 'convertFoodState', input: { grams: 100, from: 'cooked', to: 'raw', factor: 0.35 }, expect: { grams: { eq: 35 } }, note: 'also covered: missing factor returns null, never a guessed weight' }),
  F05: CAP({ fn: 'overeatingGuidance', input: { overageKcal: 200, tdee: 2200 }, expect: { mandatoryCompensation: { eq: false }, optionalActivity: { eq: true }, framing: { eq: 'informational' } } }),
  F08: DS({ input: N(), extra: { activity: { mobilityLimited: true } }, expect: { 'components.activity.state': { eq: 'not_applicable' }, 'components.activity.reason': { contains: 'individualized' } } }),
  F09: CAP({ fn: 'dedupeWorkouts', input: { sessions: [{ id: 'a', workoutType: 'run', durationMinutes: 40, startedAt: '2026-11-20T08:00:00Z' }, { id: 'b', workoutType: 'run', durationMinutes: 40, startedAt: '2026-11-20T08:05:00Z' }] }, expect: { 'sessions.length': { eq: 1 }, 'duplicatesRemoved.length': { eq: 1 }, energyInflated: { eq: true } } }),
  J01: CAP({ fn: 'supplementQuestionPolicy', input: { topic: 'magnesium_sleep', approvedContentAvailable: false }, expect: { autoRecommend: { eq: false }, uncertaintyAcknowledged: { eq: true }, outcome: { eq: 'professional_review_required' } } }),
  K05: CAP({ fn: 'rescaleServing', input: { nutrients: { calories: 400, proteinG: 20, sodiumMg: null }, servings: 2 }, expect: { calories: { eq: 800 }, proteinG: { eq: 40 }, sodiumMg: { null: true } } }),
  K08: CAP({ fn: 'detectDuplicateLog', input: { a: { foodName: 'Paneer Curry', fdcId: 'x1', loggedAt: '2026-11-20T12:00:00Z' }, b: { foodName: 'Paneer Curry', fdcId: 'x1', loggedAt: '2026-11-20T12:20:00Z' } }, expect: { possibleDuplicate: { eq: true }, needsConfirmation: { eq: true } } }),
  K09: CAP({ fn: 'validateWearableEnergy', input: { activeKcal: 4200, plausibleMaxKcal: 1200 }, expect: { plausible: { eq: false }, allowanceKcal: { eq: 1200 }, flagged: { eq: true } } }),
  L02: CAP({ fn: 'assessWeightLossRate', input: { weeklyLosses: [1.4, 1.6, 1.5], maxLossKgPerWeek: 1.0 }, expect: { outcomeReview: { eq: true }, rewardFasterLoss: { eq: false } } }),
  L10: CAP({ fn: 'detectOutcomeDivergence', input: { recentScores: [88, 91, 85], goalProgress: 'stalled' }, expect: { outcomeReview: { eq: true } } }),
  // -- Sprint D–E unlocks: deterministic ingredient-impact engine --
  C03: CAP({ fn: 'evaluatePortion', input: { meal: { foodName: 'Cola', quantityG: 330, calories: 140, addedSugarG: 35 }, goal: 'weight_loss', targets: { calories: 1800 }, categoryId: 'sugar_sweetened_beverage' }, expect: { verdict: { notNull: true }, 'education.evidence': { contains: 'WHO' } }, note: 'estimated portion data accepted; added-sugar guidance fires only when verified + goal-relevant' }),
  C04: CAP({ fn: 'evaluatePortion', input: { meal: { foodName: 'Ghee (measured)', quantityG: 60, calories: 540, fatG: 60 }, goal: 'fat_loss', targets: { caloriesTarget: 1800 }, categoryId: 'cooking_fat' }, expect: { verdict: { eq: 'moderate_portion' }, 'education.evidence': { contains: 'kcal/g' }, 'education.note': { contains: 'oil' } }, note: 'cooking method/fat handled: energy density + measured-oil education, portion dimension fires at ≥30% share' }),
  C07: CAP({ fn: 'evaluatePortion', input: { meal: { foodName: 'Almonds', quantityG: 30, calories: 174, fatG: 15, fiberG: 3.6 }, goal: 'fat_loss', targets: { caloriesTarget: 1800 }, categoryId: 'nuts_seeds' }, expect: { 'portion.calories': { eq: 174 }, verdict: { eq: 'small_portion' } }, note: 'fat quality noted while calories still counted; nutrient-dense ≠ harmful' }),
  L06: CAP({ fn: 'evaluatePortion', input: { meal: { foodName: 'Restaurant curry (estimate)', quantityG: 300 }, goal: 'weight_loss', targets: {} }, expect: { verdict: { eq: 'INCOMPLETE_DATA' } }, note: 'uncertain portions → honest insufficient-data state, never discouraging estimates' }),
  // Async DB-backed coverage exists (tests/asyncScenarios.test.js, real
  // fitness_test fixtures → getTrends/getSymptomContext). Still blocked for
  // sync-fixture counting: reviewer converts observed output → approved assert.
  A08: B({ reason: 'async evidence: tests/asyncScenarios.test.js + asyncScenarios.api.test.js (authenticated) + data/scenarioEvidence.async.json (multi-domain review data, observational basis) — needs reviewer-approved assert' }),
  A09: B({ reason: 'async evidence: tests/asyncScenarios.test.js + asyncScenarios.api.test.js (authenticated) + data/scenarioEvidence.async.json (14d coverage+goalProgress) — needs reviewer-approved assert' }),
  D02: B({ reason: 'async evidence: temporal_cooccurrence_within_6h + non-causal note verified — needs reviewer-approved assert' }),
  E04: B({ reason: 'async evidence: persistent reports → professional_review_suggested — needs reviewer-approved assert' }),
  G04: B({ reason: 'async evidence: association + dose/timing context — needs reviewer-approved assert' }),
  H01: B({ reason: 'async evidence: timing/severity enrichment + non-causal association — needs reviewer-approved assert' }),
  H02: B({ reason: 'async evidence: co-occurrence counting verified — needs reviewer-approved assert' }),
  H03: B({ reason: 'async evidence: co-occurrence counting verified — needs reviewer-approved assert' }),
  H04: B({ reason: 'async evidence: co-occurrence counting verified — needs reviewer-approved assert' }),
  H05: B({ reason: 'async evidence: persistent→professional_review_suggested — needs reviewer-approved assert' }),
  H06: B({ reason: 'async evidence: co-occurrence counting verified — needs reviewer-approved assert' }),
  H07: B({ reason: 'async evidence: single report → no escalation, no fabricated association — needs reviewer-approved assert' }),
  L03: B({ reason: 'async evidence: score_outcome_divergence review fires on stalled+high-scores — needs reviewer-approved assert' }),
  L04: B({ reason: 'async evidence: weight direction without fat-loss promise — needs reviewer-approved assert' }),
  L05: B({ reason: 'async evidence: energy adherence + activity fields available for surplus/training review — needs reviewer-approved assert' }),
};
const out = { version: 'fixtures-v1', generated: new Date().toISOString(), source: 'data/scenarioAppendixA.json (verbatim) + registry', fixtures: [] };
for (const s of reg.scenarios) {
  const e = EXEC[s.id];
  out.fixtures.push({
    id: s.id, priority: s.priority, category: s.category,
    scenario: s.scenario, expectedVerbatim: s.expectedVerbatim,
    status: e ? (e.engine === 'blocked' ? 'blocked_not_implemented' : 'executable') : 'blocked_not_implemented',
    run: e && e.engine !== 'blocked' ? { engine: e.engine, fn: e.fn, input: e.input, extra: e.extra || {} } : null,
    expect: e?.expect || null, note: e?.note || e?.reason || null,
    requiredToValidate: e ? (e.engine === 'blocked' ? [e.reason] : ['clinical reviewer confirms assert = expectedVerbatim']) : ['capability does not exist yet — author implementation + fixture'],
    evidence: null, reviewerStatus: 'pending',
  });
}
fs.writeFileSync('data/scenarioFixtures.json', JSON.stringify(out, null, 2) + '\n');
const st = {};
for (const f of out.fixtures) st[f.status] = (st[f.status] || 0) + 1;
console.log(JSON.stringify(st));

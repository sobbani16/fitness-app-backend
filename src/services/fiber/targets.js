// Personalized daily fiber target — deterministic, evidence-based.
//
// Reference values (IOM/NASEM Dietary Reference Intakes; DGA):
//   Adults (19+):      ~14 g per 1,000 kcal of the user's calorie target
//   Children/teens:    fixed Adequate Intake values — the adult formula is
//                      NEVER applied to minors:
//                        1–3y 19 g · 4–8y 25 g · 9–13y 26 g (F) / 31 g (M)
//                        14–18y 26 g (F) / 38 g (M)
//   Pregnancy:         28 g · Lactation: 29 g (IOM AI)
//   Adult AI fallback  (when no calorie target exists): 25 g F / 38 g M (19–50),
//                      21 g F / 30 g M (51+)
//
// Resolution order (first match wins):
//   1. clinician-prescribed override  (MacroGoal.fiberTargetBasis='clinician')
//   2. custom user override           (basis='custom', or legacy row where the
//                                      stored value was manually changed)
//   3. fiber-restricting condition    → conservative target + professional
//                                       review flag (never auto-prescribes)
//   4. pregnancy / lactation          → IOM AI
//   5. minor (age < 19)               → IOM AI table
//   6. adult                          → 14 g/1,000 kcal on calorie target
//   7. fallback                       → stored/static default

const TARGET_RULE_VERSION = 'fiber-target-v1';

// IOM Adequate Intake table for minors, [maxAge, female, male, other].
const MINOR_AI = [
  [3, 19, 19, 19],
  [8, 25, 25, 25],
  [13, 26, 31, 28],
  [18, 26, 38, 32],
];

// IOM adult AI when a calorie target is unavailable.
const ADULT_AI = { female: [50, 25, 21], male: [50, 38, 30], other: [50, 30, 25] };

const PREGNANCY_AI_G = 28;
const LACTATION_AI_G = 29;

const KCAL_PER_G_FIBER = 1000 / 14; // 14 g per 1,000 kcal
const DEFAULT_TARGET_G = 30; // legacy MacroGoal default — reported as default, never personalized

// Conditions where a standard "more fiber" target can be clinically wrong.
// Matched on recorded condition names — deterministic, never inferred.
const FIBER_RESTRICTION_PATTERNS = [
  { re: /bowel obstruction|intestinal obstruction|ileus/i, kind: 'obstruction', note: 'Recorded bowel obstruction — fiber increases can be harmful; clinician direction required.' },
  { re: /stricture|stenosis|narrowing/i, kind: 'stricture', note: 'Recorded intestinal stricture — fiber may need restriction; clinician direction required.' },
  { re: /gastroparesis/i, kind: 'gastroparesis', note: 'Recorded gastroparesis — fiber is commonly limited; clinician direction required.' },
  { re: /diverticulitis/i, kind: 'diverticulitis', note: 'Recorded diverticulitis — fiber guidance depends on flare vs remission; clinician direction required.' },
  { re: /crohn|ulcerative colitis|\bibd\b|inflammatory bowel/i, kind: 'ibd', note: 'Recorded IBD — fiber tolerance is individualized (flare vs remission); clinician direction required.' },
  { re: /short bowel|post[- ]?surgical|low[- ]?residue|ileostomy|ostomy|colectomy/i, kind: 'low_residue', note: 'Recorded low-residue indication — clinician direction required.' },
];

const PREGNANCY_RE = /pregnan|prenatal|expecting/i;
const LACTATION_RE = /lactat|breastfeed|nursing|postpartum/i;

function ageFrom(dateOfBirth, now = new Date()) {
  if (!(dateOfBirth instanceof Date) || !Number.isFinite(dateOfBirth.getTime())) return null;
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

function normalizeSex(gender) {
  const g = String(gender || '').toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  return 'other';
}

function minorTarget(age, sex) {
  const band = MINOR_AI.find(([max]) => age <= max);
  if (!band) return null;
  const g = sex === 'female' ? band[1] : sex === 'male' ? band[2] : band[3];
  return { targetG: g, reference: { source: 'IOM_AI_MINOR', ageBand: `≤${band[0]}` } };
}

function adultFallbackAI(age, sex) {
  const [cutoff, under, over] = ADULT_AI[sex] || ADULT_AI.other;
  const g = age != null && age > cutoff ? over : under;
  return { targetG: g, reference: { source: 'IOM_AI_ADULT', note: 'calorie target unavailable — reference AI used' } };
}

/**
 * Resolve the user's personalized daily fiber target.
 * @param {object} input
 * @param {Date|null} input.dateOfBirth
 * @param {string}    [input.gender]
 * @param {object}    [input.macroGoal]      - MacroGoal row (may be null)
 * @param {string[]}  [input.conditionNames] - active health-condition names
 * @param {number}    [input.calorieTarget]  - explicit calorie target override
 * @returns {{
 *   targetG: number|null, basis: string, reference: object,
 *   restrictions: object[], reviewRequired: boolean, notes: string[],
 *   ruleVersion: string
 * }}
 */
function resolveFiberTarget({ dateOfBirth, gender, macroGoal, conditionNames = [], calorieTarget } = {}) {
  const notes = [];
  const restrictions = [];
  const sex = normalizeSex(gender);
  const age = ageFrom(dateOfBirth instanceof Date ? dateOfBirth : dateOfBirth ? new Date(dateOfBirth) : null);
  const stored = macroGoal || {};
  const storedTarget = Number.isFinite(stored.fiberTarget) ? stored.fiberTarget : null;
  const basis = typeof stored.fiberTargetBasis === 'string' ? stored.fiberTargetBasis : null;

  // 1–2. Explicit overrides keep their provenance and are never recomputed.
  if (basis === 'clinician' && storedTarget != null) {
    return { targetG: storedTarget, basis: 'clinician', reference: { source: 'CLINICIAN', note: stored.fiberTargetNote || null }, restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
  }
  if (basis === 'custom' && storedTarget != null) {
    return { targetG: storedTarget, basis: 'custom', reference: { source: 'USER_SET' }, restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
  }

  // Legacy rows: a stored value that differs from the static default was set
  // somehow — keep it, but report provenance honestly as unknown.
  if (basis == null && storedTarget != null && storedTarget !== DEFAULT_TARGET_G) {
    return { targetG: storedTarget, basis: 'stored_unknown', reference: { source: 'STORED', note: 'set before fiber provenance tracking existed' }, restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
  }

  // 3. Fiber-restricting GI conditions — conservative reference value plus a
  // hard professional-review flag. The engine does not lower the target
  // silently below a floor either: the recorded condition determines advice,
  // not a guessed number.
  for (const cond of conditionNames) {
    for (const pat of FIBER_RESTRICTION_PATTERNS) {
      if (pat.re.test(cond)) {
        restrictions.push({ kind: pat.kind, condition: cond, note: pat.note });
      }
    }
  }
  if (restrictions.length) {
    notes.push('A recorded condition may require a clinician-directed fiber level — the value below is a conservative reference, not a prescription.');
    return {
      // Conservative 14 g reference — deliberately NOT the stored 30 g default
      // and NOT a clinical prescription; clinician direction decides.
      targetG: 14,
      basis: 'restricted_reference',
      reference: { source: 'CLINICIAN_REVIEW_REQUIRED' },
      restrictions, reviewRequired: true, notes, ruleVersion: TARGET_RULE_VERSION,
    };
  }

  // 4. Life-stage — recorded condition names only, never inferred.
  if (conditionNames.some(c => PREGNANCY_RE.test(c))) {
    return { targetG: PREGNANCY_AI_G, basis: 'reference_life_stage', reference: { source: 'IOM_AI_PREGNANCY' }, restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
  }
  if (conditionNames.some(c => LACTATION_RE.test(c))) {
    return { targetG: LACTATION_AI_G, basis: 'reference_life_stage', reference: { source: 'IOM_AI_LACTATION' }, restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
  }

  // 5. Minors — fixed AI values, never the adult formula.
  if (age != null && age < 19) {
    const t = minorTarget(age, sex);
    if (t) return { ...t, basis: 'reference_minor', restrictions, reviewRequired: age < 4, notes, ruleVersion: TARGET_RULE_VERSION };
  }

  // 6. Adults — 14 g/1,000 kcal on the user's calorie target.
  const kcal = Number.isFinite(calorieTarget) && calorieTarget > 0 ? calorieTarget
    : Number.isFinite(stored.caloriesTarget) && stored.caloriesTarget > 0 ? stored.caloriesTarget
    : null;
  if (kcal != null) {
    const targetG = Math.round(kcal / KCAL_PER_G_FIBER);
    return {
      targetG, basis: 'formula_adult',
      reference: { source: 'IOM_14G_PER_1000KCAL', calorieBasis: Math.round(kcal) },
      restrictions, reviewRequired: false,
      notes: age == null ? ['Age not on file — adult reference applied; confirm profile details.'] : notes,
      ruleVersion: TARGET_RULE_VERSION,
    };
  }

  // 7. No calorie target — adult AI by sex/age; last resort is the static default.
  if (age != null || sex !== 'other') {
    const t = adultFallbackAI(age, sex);
    return { ...t, basis: 'reference_adult_ai', restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
  }
  return { targetG: storedTarget ?? DEFAULT_TARGET_G, basis: 'default', reference: { source: 'DEFAULT', note: 'no personalization inputs available' }, restrictions, reviewRequired: false, notes, ruleVersion: TARGET_RULE_VERSION };
}

module.exports = {
  resolveFiberTarget,
  ageFrom,
  TARGET_RULE_VERSION,
  FIBER_RESTRICTION_PATTERNS,
  DEFAULT_TARGET_G,
  KCAL_PER_G_FIBER,
};

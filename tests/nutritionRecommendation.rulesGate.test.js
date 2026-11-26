// Safety-constraint test: only LIVE clinical rules (APPROVED + activated,
// not retired, not expired, review not overdue) may constrain nutrition
// suggestions. Regression for the bare reviewStatus:'APPROVED' filter that
// let unactivated/deactivated/expired rules keep firing (pc-HUM-62).
const { suggestMeals } = require('../src/services/nutritionRecommendation');
const { liveRuleWhere } = require('../src/services/healthOutcomes/clinicalRuleGovernance');

jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => false }));

// Simulates the DB applying the service's nested include-where — the only
// honest way to catch a wrong WHERE is to evaluate it for real.
function matchWhere(row, where = {}) {
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'AND') { if (!(Array.isArray(cond) ? cond : [cond]).every(w => matchWhere(row, w))) return false; continue; }
    if (k === 'OR') { if (!cond.some(w => matchWhere(row, w))) return false; continue; }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond && cond.not === null && v == null) return false;
      if ('gt' in cond && !(v != null && new Date(v) > new Date(cond.gt))) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

const RECIPE = { id: 'rec-salty', recipeName: 'Salted Broth', reviewStatus: 'SYSTEM', isSystem: true,
  calories: 300, proteinG: 10, carbsG: 40, fatG: 8, fiberG: 3,
  ingredients: [{ ingredientName: 'sodium bicarbonate broth' }] };

const rule = (over) => ({ id: 'r1', ruleCode: 'low-sodium', attribute: 'sodium', clinicalAction: 'BLOCK',
  reason: 'htn', reviewStatus: 'APPROVED', activeAt: new Date('2026-01-01'), retiredAt: null,
  expiresAt: null, reviewDueAt: null, ...over });

function prismaWith(conditionRules) {
  return {
    foodLog: { findMany: async () => [] },
    supplementDoseOccurrence: { count: async () => 0 },
    userAllergy: { findMany: async () => [] },
    userHealthCondition: {
      findMany: async ({ include }) => [{
        conditionId: 'c-htn', active: true,
        condition: { conditionRules: conditionRules.filter(r => matchWhere(r, include?.condition?.include?.conditionRules?.where || {})) },
      }],
    },
    recipe: { findMany: async () => [RECIPE] },
  };
}

const itemIds = (out) => (out.items || []).map(i => i.recipeId);

test('activated APPROVED BLOCK rule excludes the recipe', async () => {
  const out = await suggestMeals(prismaWith([rule()]), 'u1', { allowAi: false });
  expect(itemIds(out)).not.toContain('rec-salty');
});

test('APPROVED-but-never-activated rule does NOT fire', async () => {
  const out = await suggestMeals(prismaWith([rule({ activeAt: null })]), 'u1', { allowAi: false });
  expect(itemIds(out)).toContain('rec-salty');
});

test('deactivated (retiredAt) rule does NOT fire', async () => {
  const out = await suggestMeals(prismaWith([rule({ retiredAt: new Date() })]), 'u1', { allowAi: false });
  expect(itemIds(out)).toContain('rec-salty');
});

test('expired rule does NOT fire', async () => {
  const out = await suggestMeals(prismaWith([rule({ expiresAt: new Date('2020-01-01') })]), 'u1', { allowAi: false });
  expect(itemIds(out)).toContain('rec-salty');
});

test('overdue-review rule does NOT fire', async () => {
  const out = await suggestMeals(prismaWith([rule({ reviewDueAt: new Date('2020-01-01') })]), 'u1', { allowAi: false });
  expect(itemIds(out)).toContain('rec-salty');
});

test('DRAFT rule does NOT fire', async () => {
  const out = await suggestMeals(prismaWith([rule({ reviewStatus: 'DRAFT' })]), 'u1', { allowAi: false });
  expect(itemIds(out)).toContain('rec-salty');
});

test('liveRuleWhere is the exported contract the service uses', () => {
  const w = liveRuleWhere();
  expect(w.reviewStatus).toBe('APPROVED');
  expect(w.activeAt).toEqual({ not: null });
  expect(w.retiredAt).toBeNull();
});

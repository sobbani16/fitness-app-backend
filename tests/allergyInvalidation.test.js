// §5 "allergy changes invalidate": a confirmation made under the old allergy
// profile must not survive a re-check that now finds a conflict or unknown
// composition — the stale confirmedByUser is cleared and the invalidation is
// written to safetyAuditLog.
const { revalidateActivePlans } = require('../src/services/allergyRevalidation');

const ALLERGIES = { keys: ['peanut'], custom: [] };

function planWith(meals, aiIngredients = []) {
  return {
    id: 'p1', userId: 'u1', status: 'active', weekStartDate: '2026-11-23',
    generationDetails: { ai: { ingredients: aiIngredients } },
    meals,
  };
}

function fakeDb(plans) {
  const calls = { mealUpdates: [], planUpdates: [], audits: [] };
  const db = {
    weeklyNutritionPlan: {
      findMany: async () => plans,
      update: async (u) => { calls.planUpdates.push(u); return {}; },
    },
    weeklyMeal: { updateMany: async (u) => { calls.mealUpdates.push(u); return { count: 1 }; } },
    userAllergy: { findMany: async () => [{ allergy: { name: 'peanut' } }] },
    ingredient: { findMany: async () => [] },
    safetyAuditLog: { create: async (a) => { calls.audits.push(a.data); return {}; } },
  };
  return { db, calls };
}

describe('revalidateActivePlans — stale confirmation invalidation', () => {
  it('unconfirms a confirmed meal that now conflicts; writes an audit entry', async () => {
    const plan = planWith(
      [{ id: 'm1', dayOfWeek: 1, mealType: 'lunch', foodName: 'Noodles', recipe: null, confirmedByUser: true }],
      [{ dayOfWeek: 1, mealType: 'lunch', ingredients: [{ name: 'peanut sauce', resolved: true }] }],
    );
    const { db, calls } = fakeDb([plan]);
    const out = await revalidateActivePlans(db, 'u1', ALLERGIES);
    expect(calls.mealUpdates).toHaveLength(1);
    expect(calls.mealUpdates[0].where.id.in).toEqual(['m1']);
    expect(calls.mealUpdates[0].data).toEqual({ confirmedByUser: false, lockedAt: null });
    expect(calls.audits).toHaveLength(1);
    expect(calls.audits[0].checkType).toBe('allergy_invalidation');
    expect(calls.audits[0].result.confirmationsInvalidated).toBe(1);
    expect(out.weeklyPlans[0].status).toBe('conflicts');
    expect(out.weeklyPlans[0].confirmationsInvalidated).toBe(1);
  });

  it('unconfirms confirmed meals with unknown composition (fail closed)', async () => {
    const plan = planWith(
      [{ id: 'm1', dayOfWeek: 1, mealType: 'lunch', foodName: 'Mystery bowl', recipe: null, confirmedByUser: true }],
      [{ dayOfWeek: 1, mealType: 'lunch', ingredients: [{ name: 'house mix', resolved: false }] }],
    );
    const { db, calls } = fakeDb([plan]);
    const out = await revalidateActivePlans(db, 'u1', ALLERGIES);
    expect(calls.mealUpdates[0].where.id.in).toEqual(['m1']);
    expect(out.weeklyPlans[0].status).toBe('needs_review');
  });

  it('leaves confirmed meals intact when the re-check is clear', async () => {
    const plan = planWith(
      [{ id: 'm2', dayOfWeek: 2, mealType: 'dinner', foodName: 'Plain rice', recipe: null, confirmedByUser: true }],
      [{ dayOfWeek: 2, mealType: 'dinner', ingredients: [{ name: 'steamed rice', resolved: true }] }],
    );
    const { db, calls } = fakeDb([plan]);
    const out = await revalidateActivePlans(db, 'u1', ALLERGIES);
    expect(calls.mealUpdates).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
    expect(out.weeklyPlans[0].status).toBe('clear');
    expect(out.weeklyPlans[0].confirmationsInvalidated).toBe(0);
  });

  it('does not touch meals that were never confirmed', async () => {
    const plan = planWith(
      [{ id: 'm1', dayOfWeek: 1, mealType: 'lunch', foodName: 'Noodles', recipe: null, confirmedByUser: false }],
      [{ dayOfWeek: 1, mealType: 'lunch', ingredients: [{ name: 'peanut sauce', resolved: true }] }],
    );
    const { db, calls } = fakeDb([plan]);
    await revalidateActivePlans(db, 'u1', ALLERGIES);
    expect(calls.mealUpdates).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
  });
});

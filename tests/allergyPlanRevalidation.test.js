// pc-HUM-9 security regression — saved weekly plan vs newly recorded allergy.
//
// Sequence under test (real handlers, real Postgres, catalog generation only —
// no AI call, and NO mocking of the allergy check):
//   1. member generates a weekly plan while having NO recorded allergies;
//   2. member records a conflicting allergy through PUT /me/allergies;
//   3. GET /weekly-plan/current must not represent the conflicting meal as
//      compatible;
//   4. POST /weekly-plan/days/:day/confirm on a conflicting day must not record
//      success — neither in the response nor in persisted confirmedByUser;
//   5. a non-conflicting day must still confirm (control: proves the route and
//      fixtures work, so a green "rejection" can't be mistaken for protection).
//
// This suite uses REAL session auth (AUTH_TEST_BYPASS off): /me/allergies
// deliberately reads only req.userId (the session-authenticated identity), so
// the x-user-id header path cannot exercise it the way production does.
// The fixture allergen is chosen from the generated plan's own ingredient-line
// names using a label-level substring heuristic — used ONLY to PICK the
// allergen, never to decide the assertions.

process.env.AUTH_TEST_BYPASS = 'false';

const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const { createSession } = require('../src/services/authService');

const WEEK = '2026-11-30'; // a Monday — required by /weekly-plan/generate

const prisma = getPrisma();
const app = require('../src/app');

// Canonical allergen key -> conservative name heuristic for fixture selection.
const CANDIDATES = [
  ['peanut', /\bpeanut/i],
  ['milk', /\b(milk|yogh?urt|curd|paneer|cheese|ghee|cream|whey|casein|dairy)\b/i],
  ['egg', /\beggs?\b|\bomelet|\bfrittata|\bmayo\b/i],
  ['fish', /\b(salmon|tuna|cod|trout|sardine|fish)\b/i],
  ['shellfish', /\b(shrimp|prawn|crab|lobster|shellfish)\b/i],
  ['tree_nuts', /\b(almond|walnut|cashew|pecan|pistachio|hazelnut)\b/i],
  ['wheat_gluten', /\b(wheat|bread|pasta|tortilla|flour|seitan)\b/i],
  ['soy', /\b(soy|soya|tofu|edamame)\b/i],
  ['sesame', /\b(sesame|tahini|hummus)\b/i],
];

let user, token;
const AUTH = () => ({ Authorization: `Bearer ${token}` });

let planId;
let chosenKey = null;
let conflictDay = null;   // day containing a conflicting meal (unconfirmed)
let conflictDay2 = null;  // optional second conflicting day (pre-confirmed fixture)
let clearDay = null;      // day with no conflicting meal (control)

beforeAll(async () => {
  user = await prisma.user.create({
    data: { email: `pc-hum9-allergy-${Date.now()}@example.test`, emailVerifiedAt: new Date() },
  });
  ({ token } = await createSession(user));
  await prisma.macroGoal.create({ data: { userId: user.id } });
});

afterAll(async () => {
  try {
    await prisma.authSession.deleteMany({ where: { userId: user.id } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.weeklyNutritionPlan.deleteMany({ where: { userId: user.id } });
    await prisma.userAllergy.deleteMany({ where: { userId: user.id } });
    await prisma.macroGoal.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  } catch { /* disposable test DB — best-effort cleanup */ }
  process.env.AUTH_TEST_BYPASS = 'true'; // restore the harness default for other suites
});

describe('saved weekly plan vs newly recorded allergy', () => {
  it('generates an initially allergy-unrestricted catalog plan', async () => {
    const res = await request(app).post('/weekly-plan/generate').set(AUTH()).send({ weekStartDate: WEEK });
    expect(res.status).toBe(201);
    planId = res.body.planId;
    expect(planId).toBeTruthy();

    const meals = await prisma.weeklyMeal.findMany({
      where: { planId },
      include: { recipe: { include: { ingredients: true } } },
    });
    expect(meals.length).toBeGreaterThan(0);

    // Prefer a key that conflicts on >=2 but not all 7 days, so both a second
    // conflicting day (pre-confirmed fixture) and a clean control day exist.
    const scored = CANDIDATES.map(([key, re]) => {
      const days = new Set();
      for (const m of meals) {
        const text = [m.foodName, m.recipe?.recipeName, ...(m.recipe?.ingredients || []).map(i => i.ingredientName)].filter(Boolean).join(' ');
        if (re.test(text)) days.add(m.dayOfWeek);
      }
      return { key, days };
    }).filter(c => c.days.size > 0 && c.days.size < 7)
      .sort((a, b) => b.days.size - a.days.size || a.key.localeCompare(b.key));
    expect(scored.length).toBeGreaterThan(0);

    chosenKey = scored[0].key;
    const conflictDays = [...scored[0].days].sort((a, b) => a - b);
    conflictDay = conflictDays[0];
    conflictDay2 = conflictDays.length > 1 ? conflictDays[1] : null;
    clearDay = [0, 1, 2, 3, 4, 5, 6].find(d => !scored[0].days.has(d));
    expect(clearDay).not.toBeUndefined();
  });

  it('a conflicting day can be confirmed while it is still compatible (pre-allergy fixture)', async () => {
    if (conflictDay2 === null) return; // fixture offered a single conflicting day
    const res = await request(app).post(`/weekly-plan/days/${conflictDay2}/confirm`).set(AUTH()).send({ planId });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
  });

  it('read: after PUT /me/allergies the saved plan flags the conflicting meal — not represented as compatible', async () => {
    const put = await request(app).put('/me/allergies').set(AUTH()).send({ allergens: [chosenKey] });
    expect(put.status).toBe(200);
    const planResult = (put.body.revalidation?.weeklyPlans || []).find(p => p.planId === planId);
    expect(planResult?.status).toBe('conflicts');

    const res = await request(app).get('/weekly-plan/current').set(AUTH());
    expect(res.status).toBe(200);
    const check = res.body.generationDetails?.allergyCheck;
    expect(check).toBeTruthy();
    expect(check.status).toBe('conflicts');
    expect(check.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ dayOfWeek: conflictDay, allergens: expect.arrayContaining([chosenKey]) }),
    ]));
    // A day confirmed before the allergy existed is still flagged — its
    // confirmed state is surfaced, not treated as proof of compatibility.
    if (conflictDay2 !== null) {
      expect(check.conflicts).toEqual(expect.arrayContaining([
        expect.objectContaining({ dayOfWeek: conflictDay2, confirmedByUser: true }),
      ]));
    }
    // The control day stays unflagged.
    expect(check.conflicts.some(c => c.dayOfWeek === clearDay)).toBe(false);
  });

  it('control: a non-conflicting day still confirms (route and fixtures work)', async () => {
    const res = await request(app).post(`/weekly-plan/days/${clearDay}/confirm`).set(AUTH()).send({ planId });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
    const persisted = await prisma.weeklyMeal.findMany({ where: { planId, dayOfWeek: clearDay } });
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every(m => m.confirmedByUser)).toBe(true);
  });

  it('confirming a conflicting day must not record success (response AND persisted state)', async () => {
    const res = await request(app).post(`/weekly-plan/days/${conflictDay}/confirm`).set(AUTH()).send({ planId });
    const persisted = await prisma.weeklyMeal.findMany({ where: { planId, dayOfWeek: conflictDay } });
    const persistedConfirmed = persisted.filter(m => m.confirmedByUser).map(m => m.foodName);
    // Expected safety behavior: a day containing a meal that conflicts with the
    // member's recorded allergy must not be confirmable — the response must not
    // report success and no WeeklyMeal row may persist confirmedByUser=true.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.confirmed).not.toBe(true);
    expect(persistedConfirmed).toEqual([]);
  });
});

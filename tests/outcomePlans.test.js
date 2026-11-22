// Shared outcome plans (M13) — create, versioned revisions, adjustments,
// goal status, authorization.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const svc = require('../src/services/outcomePlans');

const TRAINER = { id: 't1', userId: 'trainer-user', verified: true, active: true, applicationStatus: 'approved' };
const REL = { id: 'rel1', trainerId: 't1', clientId: 'u1', status: 'active', trainer: { userId: 'trainer-user' } };

function fakeDb({ plans = [], relations = [REL] } = {}) {
  const planStore = [...plans];
  const goalStore = plans.flatMap(p => p.goals || []);
  getPrisma.mockReturnValue({
    $transaction: jest.fn(async (ops) => Promise.all(ops)),
    trainerProfile: { findUnique: jest.fn(async () => TRAINER) },
    trainerClient: {
      findUnique: jest.fn(async ({ where }) => relations.find(r => r.id === where.id) || null),
    },
    outcomePlan: {
      findFirst: jest.fn(async ({ where }) => {
        const rows = planStore.filter(p => (where.relationId === undefined || p.relationId === where.relationId) && (where.status === undefined || p.status === where.status));
        return rows.sort((a, b) => b.version - a.version)[0] || null;
      }),
      findUnique: jest.fn(async ({ where }) => {
        const p = planStore.find(x => x.id === where.id);
        return p ? { ...p, goals: goalStore.filter(g => g.planId === p.id) } : null;
      }),
      findMany: jest.fn(async ({ where, orderBy } = {}) => {
        let rows = planStore.filter(p => (!where?.clientId || p.clientId === where.clientId) && (!where?.trainerId || p.trainerId === where.trainerId) && (!where?.relationId || p.relationId === where.relationId));
        if (orderBy?.version === 'desc') rows = [...rows].sort((a, b) => b.version - a.version);
        if (orderBy?.updatedAt === 'desc') rows = [...rows].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        return rows.map(p => ({ ...p, goals: (p.goals || []).length ? p.goals : goalStore.filter(g => g.planId === p.id) }));
      }),
      create: jest.fn(async ({ data }) => {
        const p = { id: `plan-v${data.version || 1}-${planStore.length}`, version: 1, createdAt: new Date(), updatedAt: new Date(), status: 'active', ...data };
        const goals = (data.goals?.create || []).map((g, i) => ({ id: `g${planStore.length}-${i}`, planId: p.id, status: 'open', createdAt: new Date(), ...g }));
        goalStore.push(...goals);
        planStore.push(p);
        return { ...p, goals, adjustments: data.adjustments?.create ? [data.adjustments.create] : [] };
      }),
      update: jest.fn(async ({ where, data }) => { const i = planStore.findIndex(p => p.id === where.id); planStore[i] = { ...planStore[i], ...data }; return planStore[i]; }),
    },
    outcomeGoal: {
      findUnique: jest.fn(async ({ where }) => {
        const g = goalStore.find(x => x.id === where.id);
        return g ? { ...g, plan: planStore.find(p => p.id === g.planId) } : null;
      }),
      update: jest.fn(async ({ where, data }) => { const i = goalStore.findIndex(g => g.id === where.id); goalStore[i] = { ...goalStore[i], ...data }; return goalStore[i]; }),
    },
  });
  return { planStore, goalStore };
}

const GOALS = [
  { kind: 'workout_consistency', title: '3 sessions per week', baseline: '1/wk', target: '3/wk', reviewIntervalDays: 7, progressSource: 'workout_records' },
  { kind: 'confidence', title: 'Feel confident in the gym' }, // qualitative — no numbers needed
];

describe('shared outcome plans', () => {
  test('trainer creates v1 with validated goals', async () => {
    fakeDb();
    const plan = await svc.createPlan('trainer-user', { relationId: 'rel1', note: 'Q1 plan', goals: GOALS });
    expect(plan.version).toBe(1);
    expect(plan.goals.length).toBe(2);
    expect(plan.goals[1].progressSource).toBe('self_report');
    expect(plan.clientId).toBe('u1');
  });

  test('second active plan rejected — revise instead', async () => {
    fakeDb({ plans: [{ id: 'p1', relationId: 'rel1', trainerId: 't1', clientId: 'u1', version: 1, status: 'active', goals: [] }] });
    await expect(svc.createPlan('trainer-user', { relationId: 'rel1', goals: GOALS })).rejects.toMatchObject({ status: 409 });
  });

  test('revise supersedes and logs an adjustment', async () => {
    const { planStore } = fakeDb({ plans: [{ id: 'p1', relationId: 'rel1', trainerId: 't1', clientId: 'u1', version: 1, status: 'active', note: 'v1', goals: [{ id: 'g1', planId: 'p1', kind: 'custom', title: 'Old goal', sortOrder: 0 }] }] });
    const v2 = await svc.revisePlan('trainer-user', 'p1', { goals: GOALS });
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe('p1');
    expect(v2.adjustments[0].summary).toMatch(/v2/);
    expect(v2.adjustments[0].summary).toMatch(/added/);
    expect(planStore.find(p => p.id === 'p1').status).toBe('superseded');
  });

  test('goal validation: bad kind/source/interval rejected; targetDate parsed', async () => {
    fakeDb();
    await expect(svc.createPlan('trainer-user', { relationId: 'rel1', goals: [{ title: 'x', kind: 'fly' }] })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createPlan('trainer-user', { relationId: 'rel1', goals: [{ title: 'x', progressSource: 'vibes' }] })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createPlan('trainer-user', { relationId: 'rel1', goals: [{ title: 'x', reviewIntervalDays: 365 }] })).rejects.toMatchObject({ status: 400 });
    const plan = await svc.createPlan('trainer-user', { relationId: 'rel1', goals: [{ title: 'Squat 60kg', targetDate: '2027-03-01' }] });
    expect(plan.goals[0].targetDate instanceof Date).toBe(true);
  });

  test('member can mark a goal met; invalid status rejected', async () => {
    fakeDb({ plans: [{ id: 'p1', relationId: 'rel1', trainerId: 't1', clientId: 'u1', version: 1, status: 'active', goals: [{ id: 'g1', planId: 'p1', kind: 'custom', title: 'T', status: 'open' }] }] });
    await expect(svc.updateGoalStatus('u1', 'g1', { status: 'crushed' })).rejects.toMatchObject({ status: 400 });
    const g = await svc.updateGoalStatus('u1', 'g1', { status: 'met' });
    expect(g.status).toBe('met');
  });

  test('non-participant cannot read the plan', async () => {
    fakeDb({ plans: [{ id: 'p1', relationId: 'rel1', trainerId: 't1', clientId: 'u1', version: 1, status: 'active', goals: [] }] });
    await expect(svc.getPlan('p1', 'stranger')).rejects.toMatchObject({ status: 403 });
  });

  test('versions endpoint returns full history', async () => {
    fakeDb({ plans: [
      { id: 'p1', relationId: 'rel1', trainerId: 't1', clientId: 'u1', version: 1, status: 'superseded', goals: [] },
      { id: 'p2', relationId: 'rel1', trainerId: 't1', clientId: 'u1', version: 2, status: 'active', goals: [] },
    ] });
    const r = await svc.listVersions('rel1', 'u1');
    expect(r.versions.map(v => v.version)).toEqual([2, 1]);
  });
});

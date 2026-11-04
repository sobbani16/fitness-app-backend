// Weekly personal health review (M18) — evidence-only composition,
// no fabrication, capped recommendations, opt toggle, history.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
jest.mock('../src/services/sleepRecovery', () => ({ getSleepRecoverySummary: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { getSleepRecoverySummary } = require('../src/services/sleepRecovery');
const svc = require('../src/services/weeklyHealthReview');

function fakeDb(over = {}) {
  const reviews = [];
  const db = {
    user: { findUnique: jest.fn(async () => ({ goalType: 'strength', profileData: over.profileData || null })), update: jest.fn(async () => ({})) },
    foodLog: { groupBy: jest.fn(async () => over.foodDays || []) },
    workoutSession: { findMany: jest.fn(async () => over.sessions || []) },
    habitCompletion: { findMany: jest.fn(async () => over.habits || []) },
    wellnessCheckIn: { findMany: jest.fn(async () => over.wellness || []) },
    trainerClient: { findFirst: jest.fn(async () => over.relation ?? null) },
    checkIn: { findUnique: jest.fn(async () => over.checkIn ?? null) },
    outcomePlan: { findFirst: jest.fn(async () => over.plan ?? null) },
    knowledgeArticle: { findMany: jest.fn(async () => over.articles || []) },
    knowledgeArticleRevision: { findMany: jest.fn(async () => over.revisions || []) },
    weeklyHealthReview: {
      upsert: jest.fn(async ({ create }) => { const r = { id: 'r1', openedAt: null, createdAt: new Date(), ...create }; reviews.push(r); return r; }),
      findUnique: jest.fn(async ({ where }) => reviews.find((r) => +r.weekOf === +where.userId_weekOf.weekOf) || null),
      update: jest.fn(async ({ where, data }) => { Object.assign(reviews[0], data); return reviews[0]; }),
      findMany: jest.fn(async () => reviews.map(({ id, weekOf, openedAt, createdAt }) => ({ id, weekOf, openedAt, createdAt }))),
    },
  };
  getPrisma.mockReturnValue(db);
  return { db, reviews };
}

const REL = { id: 'rel1', trainerId: 't1', clientId: 'u1', status: 'active', trainer: { displayName: 'Coach Sam' } };
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - offset); return d.toISOString().slice(0, 10); };

describe('weekly health review', () => {
  beforeEach(() => { getSleepRecoverySummary.mockResolvedValue({ nights: 5, avgHours: 7.4, signals: [] }); });

  test('composes evidence-only review; claims progress only when recorded', async () => {
    const { reviews } = fakeDb({
      foodDays: [{ date: day(0) }, { date: day(1) }, { date: day(2) }, { date: day(3) }, { date: day(4) }],
      sessions: [{ finishedAt: new Date() }, { finishedAt: new Date() }, { finishedAt: new Date() }],
      habits: [{ outcome: 'done' }, { outcome: 'done' }, { outcome: 'done' }],
      wellness: [{ stress: 2 }, { stress: 2 }, { stress: 3 }, { stress: 2 }],
      relation: REL,
      checkIn: { weekOf: new Date(), reviewedAt: new Date(), trainerReply: 'Great week — keep the squat tempo.' },
      articles: [{ slug: 'protein-myth', category: 'nutrition', publishedRevisionId: 'rev1' }],
      revisions: [{ id: 'rev1', title: 'Do you need protein right after a workout?' }],
    });
    const r = await svc.getReview('u1', { tz: 'UTC' });
    expect(r.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.wentWell.length).toBeGreaterThanOrEqual(4);
    expect(r.trainer.present).toBe(true);
    expect(r.trainer.displayName).toBe('Coach Sam');
    expect(r.trainer.trainerReply).toMatch(/squat tempo/);
    expect(r.relatedContent[0].title).toMatch(/protein/i);
    expect(r.opportunities.length).toBeLessThanOrEqual(2);
    expect(r.nextWeekFocus).toBeTruthy();
    expect(reviews).toHaveLength(1); // persisted
  });

  test('sparse week: no fabricated progress, gentle focus, no trainer block', async () => {
    getSleepRecoverySummary.mockResolvedValue({ nights: 0, avgHours: null, signals: [] });
    fakeDb({}); // everything empty, no relation
    const r = await svc.getReview('u1', { tz: 'UTC' });
    expect(r.dataCompleteness).toBe('sparse');
    expect(r.wentWell).toHaveLength(0);
    expect(r.wasDifficult).toHaveLength(0);
    expect(r.progress.mealsLoggedDays).toBeNull();
    expect(r.trainer.present).toBe(false);
    expect(r.nextWeekFocus).toBeTruthy();
    expect(r.opportunities.length).toBeLessThanOrEqual(2);
  });

  test('difficulty signals only when evidenced', async () => {
    getSleepRecoverySummary.mockResolvedValue({ nights: 4, avgHours: 5.5, signals: [] });
    fakeDb({
      wellness: [{ stress: 5 }, { stress: 4 }],
      relation: REL,
      checkIn: { weekOf: new Date(), workoutDifficulty: 5, energyLevel: 1 },
    });
    const r = await svc.getReview('u1', { tz: 'UTC' });
    expect(r.wasDifficult.length).toBeGreaterThanOrEqual(3); // short sleep + stress + hard check-in + low energy
    expect(r.wasDifficult.every(w => w.evidence)).toBe(true);
    expect(r.opportunities.some(o => /wake time/.test(o.text))).toBe(true);
  });

  test('opt toggle persists on profileData', async () => {
    const { db } = fakeDb({});
    const r = await svc.setOpt('u1', { enabled: false });
    expect(r.enabled).toBe(false);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ profileData: expect.objectContaining({ weeklyReview: expect.objectContaining({ enabled: false }) }) }),
    }));
    await expect(svc.setOpt('u1', { enabled: 'yes' })).rejects.toMatchObject({ status: 400 });
  });

  test('markOpened + history', async () => {
    fakeDb({});
    const r = await svc.getReview('u1', { tz: 'UTC' });
    const o = await svc.markOpened('u1', r.weekOf);
    expect(o.opened).toBe(true);
    const h = await svc.listHistory('u1');
    expect(h.weeks).toHaveLength(1);
    await expect(svc.markOpened('u1', '1999-01-04')).rejects.toMatchObject({ status: 404 });
  });

  test('past week via weekOf is marked complete', async () => {
    fakeDb({});
    const r = await svc.getReview('u1', { tz: 'UTC', weekOf: '2020-01-08' });
    expect(r.weekOf).toBe('2020-01-06'); // Monday of that week
    expect(r.complete).toBe(true);
  });
});

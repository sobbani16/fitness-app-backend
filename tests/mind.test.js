// Mind & Habits service tests — mocked Prisma, no AI calls.
jest.mock('../src/lib/prisma', () => { const db = {
  emotionalCheckIn: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  userMindPreferences: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  mindExerciseCompletion: { create: jest.fn(), findMany: jest.fn() },
  sleepLog: { findMany: jest.fn() },
  workoutSession: { findMany: jest.fn() },
  habitCompletion: { findMany: jest.fn() },
}; return { getPrisma: () => db }; });;
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const svc = require('../src/services/mind');

describe('mind service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('check-in validation rejects bad values', async () => {
    await expect(svc.createCheckIn('u1', { mood: 'amazing', energy: 3, stress: 3 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createCheckIn('u1', { mood: 'good', energy: 9, stress: 3 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createCheckIn('u1', { mood: 'good', energy: 3, stress: 3, emotionTags: 'nope' })).rejects.toMatchObject({ status: 400 });
  });

  test('createCheckIn stores tags/journal and filters invalid context tags', async () => {
    prisma.emotionalCheckIn.create.mockResolvedValue({ id: 'c1' });
    await svc.createCheckIn('u1', { mood: 'good', energy: 4, stress: 2, contextTags: ['work', 'bogus'], emotionTags: ['calm'], journal: 'hi' }, 'Asia/Kolkata');
    const data = prisma.emotionalCheckIn.create.mock.calls[0][0].data;
    expect(data.contextTags).toEqual(['work']);
    expect(data.journal).toBe('hi');
    expect(data.timezone).toBe('Asia/Kolkata');
  });

  test('update/delete are owner-scoped', async () => {
    prisma.emotionalCheckIn.findFirst.mockResolvedValue(null);
    await expect(svc.updateCheckIn('u1', 'x', { mood: 'low' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.deleteCheckIn('u2', 'x')).rejects.toMatchObject({ status: 404 });
  });

  test('insights return insufficient below threshold — no fabricated associations', async () => {
    prisma.emotionalCheckIn.findMany.mockResolvedValue([{ loggedAt: new Date(), mood: 'good', energy: 4, stress: 2 }]);
    const out = await svc.getInsights('u1');
    expect(out.dataQuality).toBe('insufficient');
    expect(out.insights).toEqual([]);
  });

  test('insights find sleep-energy association with enough data', async () => {
    const checkins = [];
    const sleeps = [];
    for (let i = 0; i < 12; i++) {
      const day = new Date(Date.now() - i * 864e5);
      checkins.push({ loggedAt: day, mood: i % 2 ? 'good' : 'low', energy: i % 2 ? 5 : 2, stress: 3 });
      sleeps.push({ sleepEnd: day, hoursSlept: i % 2 ? 8 : 5 });
    }
    prisma.emotionalCheckIn.findMany.mockResolvedValue(checkins);
    prisma.sleepLog.findMany.mockResolvedValue(sleeps);
    prisma.workoutSession.findMany.mockResolvedValue([]);
    prisma.habitCompletion.findMany.mockResolvedValue([]);
    const out = await svc.getInsights('u1');
    expect(out.dataQuality).toBe('ok');
    expect(out.insights.length).toBeGreaterThan(0);
    expect(out.insights[0].causal).toBe(false);
    expect(out.insights[0].sampleSize).toBeGreaterThanOrEqual(10);
  });

  test('leo suggestions are supportive and never diagnostic', () => {
    const r = svc.leoSuggestions('I feel stressed today');
    expect(r.crisis).toBe(false);
    expect(r.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  test('crisis text routes to safety, not suggestions', () => {
    const r = svc.leoSuggestions('I want to hurt myself');
    expect(r.crisis).toBe(true);
    expect(r.message).toMatch(/crisis|emergency|help/i);
  });

  test('track content is original and attributed', () => {
    const t = svc.getTrack('self_awareness', []);
    expect(t.attribution).toMatch(/Goleman|original/i);
    expect(t.lessons.length).toBe(3);
    expect(() => svc.getTrack('bogus', [])).toThrow(/not found/i);
  });
});

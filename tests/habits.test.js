jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { listHabits, createHabit, updateHabit, recordOutcome } = require('../src/services/habits');

function fakeDb({ habits = [], completions = [] } = {}) {
  getPrisma.mockReturnValue({
    habit: {
      findMany: jest.fn(async () => habits),
      create: jest.fn(async d => ({ id: 'h1', ...d.data })),
      updateMany: jest.fn(async ({ where }) => ({ count: habits.some(h => h.id === where.id && (h.userId || 'u1') === where.userId) ? 1 : 0 })),
      findFirst: jest.fn(async ({ where }) => habits.find(h => h.id === where.id) || null),
    },
    habitCompletion: {
      findMany: jest.fn(async () => completions),
      upsert: jest.fn(async d => d.create),
    },
  });
}

const base = { id: 'h1', title: 'Walk 10 min', kind: 'movement_break', status: 'active', daysOfWeek: 127, snoozedUntil: null, createdAt: new Date() };

describe('habit coaching', () => {
  test('scheduled daily habit shows open today', async () => {
    fakeDb({ habits: [base] });
    const r = await listHabits('u1', 'UTC');
    expect(r.habits[0].scheduledToday).toBe(true);
    expect(r.habits[0].todayOutcome).toBeNull();
  });

  test('paused or snoozed habits are not scheduled', async () => {
    fakeDb({ habits: [{ ...base, status: 'paused' }, { ...base, id: 'h2', snoozedUntil: new Date(Date.now() + 86400000) }] });
    const r = await listHabits('u1', 'UTC');
    expect(r.habits.every(h => !h.scheduledToday)).toBe(true);
  });

  test('completion upserts per day; invalid outcome rejected', async () => {
    fakeDb({ habits: [base] });
    await expect(recordOutcome('u1', 'h1', 'bogus')).rejects.toMatchObject({ status: 400 });
    const r = await recordOutcome('u1', 'h1', 'done');
    expect(r.outcome).toBe('done');
    const l = await listHabits('u1', 'UTC');
    // recorded outcome would come back via completions in a real db
    expect(l.habits[0].scheduledToday).toBe(true);
  });

  test('validation: bad kind / empty title / bad bitmask', async () => {
    fakeDb({});
    await expect(createHabit('u1', { title: '' })).rejects.toMatchObject({ status: 400 });
    await expect(createHabit('u1', { title: 'x', kind: 'bogus' })).rejects.toMatchObject({ status: 400 });
    await expect(createHabit('u1', { title: 'x', daysOfWeek: 200 })).rejects.toMatchObject({ status: 400 });
    const h = await createHabit('u1', { title: 'Sleep by 11', kind: 'sleep_window' });
    expect(h.kind).toBe('sleep_window');
  });

  test('update is user-scoped; cross-user gets 404', async () => {
    fakeDb({ habits: [base] });
    await expect(updateHabit('other-user', 'h1', { status: 'archived' })).rejects.toMatchObject({ status: 404 });
    await expect(updateHabit('u1', 'h1', { status: 'invalid' })).rejects.toMatchObject({ status: 400 });
  });
});

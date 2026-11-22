// Fiber reminder path — send-time engine evaluation, flag gating, and the
// food-first body contract (no supplement pushes, no stale totals).

const mockFlags = { enabled: true };
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => (key === 'fiber_reminders_enabled' ? mockFlags.enabled : false),
}));

const mockEngine = { current: null };
jest.mock('../src/services/fiber/dailyEngine', () => ({
  dailyFiber: async () => mockEngine.current,
  fiberReminderBody: jest.requireActual('../src/services/fiber/dailyEngine').fiberReminderBody,
  GAP_SUGGESTION_THRESHOLD_G: 4,
}));

const { fiberReminderBody } = jest.requireActual('../src/services/fiber/dailyEngine');
const { runTick, candidates } = require('../src/services/reminders/scheduler');
const { wallTimeToUtc } = require('../src/services/reminders/time');

const USER = 'u-fiber';
const NOW = new Date('2026-11-22T17:00:00Z'); // 12:00 ET — inside quiet-free window

function engineOutput(overrides = {}) {
  return {
    date: '2026-11-22',
    target: { targetG: 28, basis: 'formula_adult' },
    status: { confirmedG: 12, remainingG: 16, mealsLogged: 2, ...overrides.status },
    suggestions: [{ food: 'Chana masala', serving: '1 cup', approxFiberG: 12 }],
    ...overrides,
  };
}

function pendingFiber() {
  return [{
    id: 'inst-1', userId: USER, category: 'fiber',
    dedupeKey: `${USER}|fiber|2026-11-22|12:00|0`,
    scheduledFor: NOW, payload: null, why: 'test', status: 'pending',
  }];
}

function fakePrisma(instances, notifications) {
  return {
    reminderPreference: { findUnique: async () => ({ userId: USER, masterEnabled: true, adaptiveEnabled: true, quietStart: null, quietEnd: null, dailyCap: 3, timezone: 'America/New_York' }) },
    reminderInstance: {
      findMany: async ({ where }) => (where.status === 'sent' ? [] : instances.filter((i) => i.status === 'pending' && i.scheduledFor <= NOW)),
      count: async () => 0,
      update: async ({ where, data }) => Object.assign(instances.find((i) => i.id === where.id), data),
      updateMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    reminderCategorySetting: {
      findUnique: async () => ({ userId: USER, category: 'fiber', enabled: true, source: 'manual' }),
      findMany: async () => [],
    },
    sleepLog: { count: async () => 0 },
    workoutSession: { count: async () => 0, findMany: async () => [] },
    foodLog: { findMany: async () => [] },
    waterLog: { findFirst: async () => null },
    supplementLog: { findMany: async () => [] },
    supplementDoseOccurrence: { updateMany: async () => ({ count: 0 }) },
    notification: { create: async ({ data }) => { notifications.push(data); return data; } },
    userEvent: { create: async () => ({}) },
    userSymptomReport: { findMany: async () => [] },
  };
}

beforeEach(() => { mockFlags.enabled = true; mockEngine.current = engineOutput(); });

describe('fiberReminderBody', () => {
  it('frames an open gap with the confirmed total and a food suggestion', () => {
    const body = fiberReminderBody(engineOutput());
    expect(body).toMatch(/12 g of your 28 g/);
    expect(body).toMatch(/Chana masala/);
    expect(body).not.toMatch(/supplement|psyllium|isabgol/i);
  });
  it('shows the goal as planning guidance when nothing is logged', () => {
    const body = fiberReminderBody(engineOutput({ status: { mealsLogged: 0, confirmedG: 0, remainingG: 28 } }));
    expect(body).toMatch(/goal is 28 g/);
  });
  it('acknowledges a reached goal without pushing more', () => {
    const body = fiberReminderBody(engineOutput({ status: { mealsLogged: 3, confirmedG: 28, remainingG: 0 } }));
    expect(body).toMatch(/reached/);
  });
  it('returns null when no target exists (reminder suppressed upstream)', () => {
    expect(fiberReminderBody({ target: { targetG: null } })).toBeNull();
  });
});

describe('candidates — fiber scheduling', () => {
  it('plans times-based fiber instances with dedupe keys', () => {
    const settings = [{ userId: USER, category: 'fiber', enabled: true, source: 'manual', times: ['12:00'] }];
    // 11:50 ET — the 12:00 slot lands inside the 15-minute planning window.
    const out = candidates({ masterEnabled: true, timezone: 'America/New_York' }, settings, { userId: USER, now: new Date('2026-11-22T16:50:00Z'), events: [] });
    expect(out.length).toBe(1);
    expect(out[0].category).toBe('fiber');
    expect(out[0].dedupeKey).toContain('|fiber|');
    expect(out[0].priority).toBeGreaterThan(4); // yields to manual + adaptive slots
  });
});

describe('runTick — fiber send-time evaluation', () => {
  it('suppresses when the flag is off (planned before disable)', async () => {
    mockFlags.enabled = false;
    const inst = pendingFiber(); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('suppressed');
    expect(inst[0].reason).toBe('feature_disabled');
    expect(notes.length).toBe(0);
  });
  it('suppresses when the engine cannot resolve a target', async () => {
    mockEngine.current = null;
    const inst = pendingFiber(); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('suppressed');
    expect(inst[0].reason).toBe('no_fiber_target');
  });
  it('suppresses as already_completed when the gap is closed', async () => {
    mockEngine.current = engineOutput({ status: { confirmedG: 28, remainingG: 0, mealsLogged: 3 } });
    const inst = pendingFiber(); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('suppressed');
    expect(inst[0].reason).toBe('already_completed');
    expect(notes.length).toBe(0);
  });
  it('sends a food-first body computed at send time when a gap remains', async () => {
    const inst = pendingFiber(); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes.length).toBe(1);
    expect(notes[0].body).toMatch(/12 g of your 28 g/);
    expect(notes[0].body).toMatch(/Chana masala/);
    expect(notes[0].body).not.toMatch(/psyllium|isabgol|supplement/i);
  });
});

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

const mockWeekly = { current: null };
jest.mock('../src/services/fiber/weeklyReview', () => ({
  weeklyReview: async () => mockWeekly.current,
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

function pendingFiber(kind) {
  return [{
    id: 'inst-1', userId: USER, category: 'fiber',
    dedupeKey: `${USER}|fiber|2026-11-22|${kind ? `auto:${kind}` : '12:00|0'}`,
    scheduledFor: NOW, payload: kind ? { kind } : null, why: 'test', status: 'pending',
  }];
}

function fakePrisma(instances, notifications, now = NOW) {
  return {
    reminderPreference: { findUnique: async () => ({ userId: USER, masterEnabled: true, adaptiveEnabled: true, quietStart: null, quietEnd: null, dailyCap: 3, timezone: 'America/New_York' }) },
    reminderInstance: {
      findMany: async ({ where }) => (where.status === 'sent' ? [] : instances.filter((i) => i.status === 'pending' && i.scheduledFor <= now)),
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

describe('candidates — fiber auto windows', () => {
  const prefs = { masterEnabled: true, timezone: 'America/New_York' };
  const fiberSetting = { userId: USER, category: 'fiber', enabled: true, source: 'manual', times: ['auto'] };

  it('plans kind-tagged instances inside each window', () => {
    // 08:30 ET default morning = 13:30Z. Tick at 13:25Z plans it.
    const out = candidates(prefs, [fiberSetting], { userId: USER, now: new Date('2026-11-22T13:25:00Z'), events: [] });
    const morning = out.find((c) => c.payload?.kind === 'morning');
    expect(morning).toBeTruthy();
    expect(morning.dedupeKey).toContain('|fiber|2026-11-22|auto:morning');
    expect(morning.priority).toBeGreaterThan(4);
  });

  it('plans all four daily kinds across the day', () => {
    const kinds = new Set();
    for (const iso of ['2026-11-22T13:25:00Z', '2026-11-22T17:25:00Z', '2026-11-22T22:40:00Z', '2026-11-23T01:25:00Z']) {
      candidates(prefs, [fiberSetting], { userId: USER, now: new Date(iso), events: [] })
        .forEach((c) => kinds.add(c.payload?.kind));
    }
    expect(kinds.has('morning')).toBe(true);
    expect(kinds.has('midday')).toBe(true);       // 12:30 ET = 17:30Z
    expect(kinds.has('pre_dinner')).toBe(true);   // 17:45 ET = 22:45Z
    expect(kinds.has('evening')).toBe(true);      // 20:30 ET cap 21:00 → 01:00Z/01:30Z
  });

  it('derives windows from the user’s own meal-reminder times', () => {
    const meals = [
      { userId: USER, category: 'meal:dinner', enabled: true, source: 'manual', times: ['18:00'] },
      fiberSetting,
    ];
    // Dinner 18:00 → pre_dinner 16:45 ET = 21:45Z. Tick 21:40Z should plan it.
    const out = candidates(prefs, meals, { userId: USER, now: new Date('2026-11-22T21:40:00Z'), events: [] });
    expect(out.some((c) => c.payload?.kind === 'pre_dinner')).toBe(true);
  });

  it('adds the weekly window on Sundays only', () => {
    const sat = new Date('2026-11-21T13:25:00Z');    // Saturday morning ET
    const sunOut = candidates(prefs, [fiberSetting], { userId: USER, now: new Date('2026-11-23T01:20:00Z'), events: [] });
    expect(sunOut.some((c) => c.payload?.kind === 'weekly')).toBe(true);
    const satOut = candidates(prefs, [fiberSetting], { userId: USER, now: sat, events: [] });
    expect(satOut.some((c) => c.payload?.kind === 'weekly')).toBe(false);
  });

  it('explicit HH:MM times keep working alongside auto', () => {
    const mixed = { ...fiberSetting, times: ['auto', '12:00'] };
    const out = candidates(prefs, [mixed], { userId: USER, now: new Date('2026-11-22T16:50:00Z'), events: [] });
    expect(out.some((c) => c.dedupeKey.includes('|12:00|'))).toBe(true);
  });
});

describe('runTick — auto-window send-time rules', () => {
  it('suppresses midday when nothing is logged (quiet morning ≠ deficit)', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 0, confirmedG: 0, remainingG: 28 } });
    const inst = pendingFiber('midday'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('suppressed');
    expect(inst[0].reason).toBe('too_early_no_logs');
  });

  it('suppresses midday and pre_dinner when coverage is mostly unknown', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 3, completeness: 'low' } });
    for (const kind of ['midday', 'pre_dinner']) {
      const inst = pendingFiber(kind); const notes = [];
      await runTick(fakePrisma(inst, notes), { now: NOW });
      expect(inst[0].reason).toBe('incomplete_data');
      expect(notes.length).toBe(0);
    }
  });

  it('suppresses gap nudges for clinician-guided (restricted) targets', async () => {
    mockEngine.current = engineOutput({ target: { targetG: 15, reviewRequired: true, restrictions: [{ note: 'IBD flare protocol' }] } });
    const inst = pendingFiber('pre_dinner'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('suppressed');
    expect(inst[0].reason).toBe('restricted_target');
  });

  it('lets restricted users keep the neutral morning planning check-in', async () => {
    mockEngine.current = engineOutput({ target: { targetG: 15, reviewRequired: true } });
    const inst = pendingFiber('morning'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes[0].body).toMatch(/clinician-guided/);
    expect(notes[0].body).not.toMatch(/Chana masala|\d+ g of/); // no picks, no gap framing
  });

  it('suppresses any fiber send after 21:30 local', async () => {
    const LATE = new Date('2026-11-23T02:30:00Z'); // 21:30 ET
    const inst = pendingFiber('evening');
    inst[0].scheduledFor = LATE;
    const notes = [];
    await runTick(fakePrisma(inst, notes, LATE), { now: LATE });
    expect(inst[0].reason).toBe('late_evening');
  });

  it('morning check-in sends planning copy — never a deficit claim', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 0, confirmedG: 0, remainingG: 28 } });
    const inst = pendingFiber('morning'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes[0].body).toMatch(/goal is 28 g/);
    expect(notes[0].body).not.toMatch(/0 g|behind|deficit|missing/i);
  });

  it('evening summary is nonjudgmental and pushes no food or supplement', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 2, confirmedG: 12, remainingG: 16 } });
    const inst = pendingFiber('evening'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes[0].body).toMatch(/no catching up needed/i);
    expect(notes[0].body).not.toMatch(/Chana masala|psyllium|supplement/i);
  });

  it('evening summary still sends when the goal is met (congrats)', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 3, confirmedG: 28, remainingG: 0 } });
    const inst = pendingFiber('evening'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes[0].body).toMatch(/reached/);
  });

  it('pre_dinner sends a food-first gap suggestion when a real gap remains', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 2, confirmedG: 12, remainingG: 16, completeness: 'complete' } });
    const inst = pendingFiber('pre_dinner'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes[0].body).toMatch(/Chana masala/);
    expect(notes[0].body).toMatch(/dinner/);
    expect(notes[0].body).not.toMatch(/psyllium|supplement/i);
  });

  it('midday with a closed gap suppresses as already_completed', async () => {
    mockEngine.current = engineOutput({ status: { mealsLogged: 2, confirmedG: 28, remainingG: 0 } });
    const inst = pendingFiber('midday'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].reason).toBe('already_completed');
  });

  it('weekly sends the review headline plus one sustainable swap', async () => {
    mockWeekly.current = {
      headline: 'Across 5 well-logged days, fiber averaged ~14 g against a 28 g target.',
      patterns: [{ mealType: 'dinner', addFood: 'Chana masala', suggestion: 'A side like Chana masala (1 cup, ~12 g) alongside it would cover most of a day’s gap.' }],
    };
    const inst = pendingFiber('weekly'); const notes = [];
    await runTick(fakePrisma(inst, notes), { now: NOW });
    expect(inst[0].status).toBe('sent');
    expect(notes[0].title).toMatch(/Weekly fiber review/);
    expect(notes[0].body).toMatch(/well-logged days/);
    expect(notes[0].body).toMatch(/Chana masala/);
    expect(notes[0].body).not.toMatch(/psyllium|supplement/i);
    mockWeekly.current = null;
  });
});

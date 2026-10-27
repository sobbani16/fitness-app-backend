const { evaluate } = require('../src/services/reminders/decisionEngine');
const { localParts, parseHHMM, inQuietHours, wallTimeToUtc, formatMinutes } = require('../src/services/reminders/time');
const { analyzeMeals, analyzeWater, analyzeSupplements, buildSuggestions } = require('../src/services/reminders/learning');
const prefs = require('../src/services/reminders/preferences');
const { SUPPRESS } = require('../src/services/reminders/constants');

const TZ = 'America/New_York';
const NOW = new Date('2026-10-27T16:30:00Z'); // 12:30 PM EDT, Tuesday

const basePrefs = { masterEnabled: true, adaptiveEnabled: true, quietStart: '22:00', quietEnd: '07:00', dailyCap: 3, pausedUntil: null };
const baseSetting = { enabled: true, source: 'manual' };
const baseCtx = {
  now: NOW,
  nowLocal: localParts(NOW, TZ),
  prefs: basePrefs,
  setting: baseSetting,
};

describe('decision engine', () => {
  it('sends when everything is eligible', () => {
    expect(evaluate(baseCtx).decision).toBe('send');
  });
  it.each([
    [{ prefs: { ...basePrefs, masterEnabled: false } }, SUPPRESS.NOT_OPTED_IN],
    [{ prefs: { ...basePrefs, pausedUntil: new Date('2026-10-27T20:00:00Z') } }, SUPPRESS.PAUSED],
    [{ setting: { ...baseSetting, enabled: false } }, SUPPRESS.CATEGORY_DISABLED],
    [{ setting: { enabled: true, source: 'adaptive' }, prefs: { ...basePrefs, adaptiveEnabled: false } }, SUPPRESS.ADAPTIVE_NOT_CONSENTED],
    [{ sleeping: true }, SUPPRESS.SLEEPING],
    [{ activeWorkout: true }, SUPPRESS.ACTIVE_WORKOUT],
    [{ completed: true }, SUPPRESS.ALREADY_DONE],
    [{ snoozedUntil: new Date('2026-10-27T17:00:00Z') }, SUPPRESS.SNOOZED],
    [{ dedupeExists: true }, SUPPRESS.DUPLICATE],
    [{ requiresFreshData: true, freshData: false }, SUPPRESS.STALE_DATA],
    [{ sentToday: 3, setting: { enabled: true, source: 'adaptive' } }, SUPPRESS.DAILY_CAP],
    [{ lastSentAt: new Date('2026-10-27T16:15:00Z') }, SUPPRESS.COOLDOWN],
  ])('suppresses with reason %j', (override, reason) => {
    expect(evaluate({ ...baseCtx, ...override }).reason).toBe(reason);
  });
  it('manual schedules are exempt from the daily cap', () => {
    expect(evaluate({ ...baseCtx, sentToday: 10, setting: { enabled: true, source: 'manual' } }).decision).toBe('send');
  });
  it('resumes after pause expires', () => {
    const ctx = { ...baseCtx, prefs: { ...basePrefs, pausedUntil: new Date('2026-10-27T16:00:00Z') } };
    expect(evaluate(ctx).decision).toBe('send');
  });
  it('quiet hours wrap midnight', () => {
    const late = new Date('2026-10-28T03:30:00Z'); // 23:30 EDT
    expect(evaluate({ ...baseCtx, now: late, nowLocal: localParts(late, TZ) }).reason).toBe(SUPPRESS.QUIET_HOURS);
    const early = new Date('2026-10-27T10:30:00Z'); // 06:30 EDT
    expect(evaluate({ ...baseCtx, now: early, nowLocal: localParts(early, TZ) }).reason).toBe(SUPPRESS.QUIET_HOURS);
  });
  it('category waking window overrides quiet hours', () => {
    const ctx = { ...baseCtx, wakingStart: '08:00', wakingEnd: '21:00' };
    expect(evaluate(ctx).decision).toBe('send');
  });
});

describe('time helpers', () => {
  it('parses and formats HH:MM', () => {
    expect(parseHHMM('12:30')).toBe(750);
    expect(parseHHMM('7:05')).toBe(425);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('noon')).toBeNull();
    expect(formatMinutes(750)).toBe('12:30');
  });
  it('detects quiet hours incl. overnight', () => {
    expect(inQuietHours(23 * 60, '22:00', '07:00')).toBe(true);
    expect(inQuietHours(6 * 60, '22:00', '07:00')).toBe(true);
    expect(inQuietHours(12 * 60, '22:00', '07:00')).toBe(false);
  });
  it('converts wall time to UTC across DST', () => {
    // EDT (UTC-4): 12:30 -> 16:30Z; after Nov 1 EST (UTC-5): 12:30 -> 17:30Z
    expect(wallTimeToUtc('2026-10-27', 750, TZ).toISOString()).toBe('2026-10-27T16:30:00.000Z');
    expect(wallTimeToUtc('2026-11-02', 750, TZ).toISOString()).toBe('2026-11-02T17:30:00.000Z');
  });
  it('marks weekends', () => {
    expect(localParts(new Date('2026-10-25T16:00:00Z'), TZ).isWeekend).toBe(true); // Sunday
    expect(localParts(NOW, TZ).isWeekend).toBe(false);
  });
});

describe('learning gates', () => {
  const lunchAt = iso => ({ mealType: 'lunch', loggedAt: new Date(iso) });
  it('never suggests with fewer than 3 comparable days', () => {
    const logs = [lunchAt('2026-10-26T16:05:00Z'), lunchAt('2026-10-27T16:10:00Z')];
    const analysis = analyzeMeals(logs, TZ);
    expect(analysis.lunch).toEqual([]);
    expect(buildSuggestions({ meals: analysis })).toEqual([]);
  });
  it('suggests after 3 weekday lunches near noon, reminding 30 min later', () => {
    const logs = [
      lunchAt('2026-10-21T16:05:00Z'), lunchAt('2026-10-22T16:10:00Z'), lunchAt('2026-10-23T16:00:00Z'), lunchAt('2026-10-26T16:08:00Z'),
    ];
    const [s] = buildSuggestions({ meals: analyzeMeals(logs, TZ) });
    expect(s.category).toBe('meal:lunch');
    expect(s.proposed.times).toEqual(['12:30']); // typical ~12:00 + 30 min grace
    expect(s.proposed.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(s.evidence.observations).toBe(4);
    expect(s.body).toContain('12:30');
  });
  it('splits weekday and weekend patterns separately', () => {
    const logs = [
      lunchAt('2026-10-21T16:00:00Z'), lunchAt('2026-10-22T16:00:00Z'), lunchAt('2026-10-23T16:00:00Z'),
      lunchAt('2026-10-24T19:00:00Z'), lunchAt('2026-10-25T19:00:00Z'), lunchAt('2026-10-18T19:00:00Z'),
    ];
    const suggestions = buildSuggestions({ meals: analyzeMeals(logs, TZ) });
    expect(suggestions.map(s => s.evidence.pattern).sort()).toEqual(['weekday', 'weekend']);
  });
  it('does not reprompt for pending, accepted, or manually configured categories', () => {
    const logs = [lunchAt('2026-10-21T16:00:00Z'), lunchAt('2026-10-22T16:00:00Z'), lunchAt('2026-10-23T16:00:00Z')];
    const analysis = analyzeMeals(logs, TZ);
    expect(buildSuggestions({ meals: analysis }, new Set(['meal:lunch:weekday']))).toEqual([]);
  });
  it('water needs 3 days with real intervals; missing days are not evidence', () => {
    const day = (d, times) => times.map(m => ({ loggedAt: new Date(`2026-10-${d}T${m}:00Z`) }));
    const sparse = [...day('21', ['16:00']), ...day('22', ['16:00']), ...day('23', ['16:00'])];
    expect(analyzeWater(sparse, TZ)).toBeNull(); // one log/day -> no intervals
    const rich = [...day('21', ['14:00', '17:00']), ...day('22', ['14:30', '17:30']), ...day('23', ['14:15', '17:15']), ...day('24', ['14:00'])];
    const w = analyzeWater(rich, TZ);
    expect(w.intervalMinutes).toBe(180);
    expect(w.observations).toBe(3);
  });
  it('supplement times learn per supplement name', () => {
    const log = n => iso => ({ supplementName: n, loggedAt: new Date(iso) });
    const logs = [log('Creatine')('2026-10-21T23:00:00Z'), log('Creatine')('2026-10-22T23:05:00Z'), log('Creatine')('2026-10-23T23:00:00Z'), log('Whey')('2026-10-23T12:00:00Z')];
    const s = analyzeSupplements(logs, TZ);
    expect(s.Creatine[0].typicalMinutes).toBe(19 * 60); // 19:00 EDT
    expect(s.Whey).toEqual([]);
  });
});

describe('preferences and consent', () => {
  const mkPrisma = () => {
    const store = { pref: null, settings: new Map(), suggestions: new Map() };
    return {
      store,
      reminderPreference: {
        findUnique: async ({ where }) => (store.pref?.userId === where.userId ? store.pref : null),
        upsert: async ({ where, create, update }) => { store.pref = { id: 'p1', ...(store.pref?.userId === where.userId ? store.pref : create), ...update }; return store.pref; },
      },
      reminderCategorySetting: {
        findUnique: async ({ where }) => store.settings.get(where.userId_category.category) || null,
        findMany: async () => [...store.settings.values()],
        upsert: async ({ where, create, update }) => { const c = where.userId_category.category; const row = { id: `s-${c}`, ...(store.settings.get(c) || create), ...update }; store.settings.set(c, row); return row; },
        updateMany: async ({ where, data }) => { for (const [k, v] of store.settings) if ((!where.source || v.source === where.source)) store.settings.set(k, { ...v, ...data }); },
      },
      reminderSuggestion: {
        findUnique: async ({ where }) => store.suggestions.get(where.id) || null,
        update: async ({ where, data }) => { const s = { ...store.suggestions.get(where.id), ...data }; store.suggestions.set(where.id, s); return s; },
        updateMany: async ({ where, data }) => { for (const [k, v] of store.suggestions) if (v.status === 'pending') store.suggestions.set(k, { ...v, ...data }); },
      },
    };
  };

  it('defaults are all off — nothing reminds without opt-in', () => {
    const d = prefs.defaults('u1');
    expect(d.masterEnabled).toBe(false);
    expect(d.adaptiveEnabled).toBe(false);
    expect(d.suggestionsMuted).toBe(false);
  });
  it('rejects invalid preference values', () => {
    expect(() => prefs.validatePrefs({ dailyCap: 99 })).toThrow('dailyCap');
    expect(() => prefs.validatePrefs({ snoozeMinutes: 7 })).toThrow('snoozeMinutes');
    expect(() => prefs.validatePrefs({ quietStart: 'midnight' })).toThrow('quietStart');
    expect(() => prefs.validatePrefs({ timezone: 'Mars/Olympus' })).toThrow('IANA');
    expect(prefs.validatePrefs({ dailyCap: 5, quietStart: '22:00' })).toEqual({ dailyCap: 5, quietStart: '22:00' });
  });
  it('rejects invalid category patches', () => {
    expect(() => prefs.validateCategory('meal:lunch', { times: ['25:00'] })).toThrow('HH:MM');
    expect(() => prefs.validateCategory('movement', { intervalMinutes: 30 })).toThrow('60-120');
    expect(() => prefs.validateCategory('nonsense', {})).toThrow('Unknown category');
    expect(prefs.validateCategory('water', { intervalMinutes: 90 })).toEqual({ intervalMinutes: 90 });
  });
  it('accepting a suggestion creates an adaptive schedule', async () => {
    const prisma = mkPrisma();
    prisma.store.pref = { userId: 'u1', masterEnabled: true, adaptiveEnabled: true };
    prisma.store.suggestions.set('s1', { id: 's1', userId: 'u1', category: 'meal:lunch', status: 'pending', proposed: { times: ['12:45'], daysOfWeek: [1, 2, 3, 4, 5] } });
    const setting = await prefs.acceptSuggestion(prisma, 'u1', 's1');
    expect(setting).toMatchObject({ enabled: true, source: 'adaptive', times: ['12:45'] });
    expect(prisma.store.suggestions.get('s1').status).toBe('accepted');
  });
  it('rejecting acceptance without adaptive consent', async () => {
    const prisma = mkPrisma();
    prisma.store.suggestions.set('s1', { id: 's1', userId: 'u1', category: 'meal:lunch', status: 'pending', proposed: {} });
    await expect(prefs.acceptSuggestion(prisma, 'u1', 's1')).rejects.toThrow('Adaptive reminders are not enabled');
  });
  it('manual schedules block suggestions from overwriting them', async () => {
    const prisma = mkPrisma();
    prisma.store.pref = { userId: 'u1', adaptiveEnabled: true };
    prisma.store.settings.set('meal:lunch', { userId: 'u1', category: 'meal:lunch', enabled: true, source: 'manual', times: ['12:00'] });
    prisma.store.suggestions.set('s1', { id: 's1', userId: 'u1', category: 'meal:lunch', status: 'pending', proposed: { times: ['12:45'] } });
    await expect(prefs.acceptSuggestion(prisma, 'u1', 's1')).rejects.toThrow('manual schedule');
    expect(prisma.store.suggestions.get('s1').status).toBe('pending');
  });
  it('revoking adaptive consent disables adaptive schedules and expires pending suggestions', async () => {
    const prisma = mkPrisma();
    prisma.store.settings.set('meal:lunch', { userId: 'u1', category: 'meal:lunch', enabled: true, source: 'adaptive' });
    prisma.store.suggestions.set('s1', { id: 's1', userId: 'u1', status: 'pending' });
    await prefs.revokeAdaptive(prisma, 'u1');
    expect(prisma.store.pref.adaptiveEnabled).toBe(false);
    expect(prisma.store.settings.get('meal:lunch').enabled).toBe(false);
    expect(prisma.store.suggestions.get('s1').status).toBe('expired');
  });
  it('declining is a no-op on resolved suggestions; mute expires the rest', async () => {
    const prisma = mkPrisma();
    prisma.store.suggestions.set('s1', { id: 's1', userId: 'u1', status: 'accepted' });
    prisma.store.suggestions.set('s2', { id: 's2', userId: 'u1', status: 'pending' });
    const s1 = await prefs.declineSuggestion(prisma, 'u1', 's1', { mute: true });
    expect(s1.status).toBe('accepted');
    expect(prisma.store.suggestions.get('s2').status).toBe('expired');
    expect(prisma.store.pref.suggestionsMuted).toBe(true);
  });
});

describe('conflict resolution and triggers', () => {
  const { candidates } = require('../src/services/reminders/scheduler');
  const basePrefs2 = { masterEnabled: true, adaptiveEnabled: true, timezone: 'America/New_York' };
  const now = new Date('2026-10-27T16:25:00Z'); // 12:25 EDT — within plan window of 12:30

  it('merges a meal and supplement reminder in the same slot', () => {
    const settings = [
      { category: 'meal:lunch', enabled: true, source: 'manual', times: ['12:30'] },
      { category: 'supplement', enabled: true, source: 'manual', times: [] },
    ];
    const supplementSchedules = [{ id: 'ss1', supplementId: 'sup1', userSupplementId: 'us1', dose: '5g', reminderTime: '12:30', active: true }];
    const plan = candidates(basePrefs2, settings, { userId: 'u1', now, lastWaterAt: null, supplementSchedules, events: [] });
    expect(plan).toHaveLength(1);
    expect(plan[0].category).toBe('bundle:meal:lunch+supplement');
    expect(plan[0].dedupeKey).toContain('bundle');
  });
  it('defers an optional water reminder rather than completing it', () => {
    const settings = [
      { category: 'meal:lunch', enabled: true, source: 'manual', times: ['12:30'] },
      { category: 'water', enabled: true, source: 'manual', intervalMinutes: 60 },
    ];
    const lastWater = new Date('2026-10-27T15:25:00Z'); // gap ends 16:25Z, within 10 min of the 12:30 lunch
    const plan = candidates(basePrefs2, settings, { userId: 'u1', now, lastWaterAt: lastWater, supplementSchedules: [], events: [] });
    expect(plan).toHaveLength(2);
    const water = plan.find(p => p.category === 'water');
    expect(water.scheduledFor.getTime()).toBe(plan.find(p => p.category === 'meal:lunch').scheduledFor.getTime() + 15 * 60000);
    expect(water.dedupeKey).toContain('deferred');
    expect(water.status).toBeUndefined(); // stays schedulable, never completed
  });
  it('triggered reminders require a confirmed event', () => {
    const settings = [{ category: 'supplement', enabled: true, source: 'manual', times: [], triggerEvent: 'meal:breakfast', triggerDelay: 15 }];
    const noEvent = candidates(basePrefs2, settings, { userId: 'u1', now, lastWaterAt: null, supplementSchedules: [], events: [] });
    expect(noEvent).toEqual([]);
    const ev = { type: 'meal:breakfast', id: 'log-1', at: new Date('2026-10-27T16:10:00Z') };
    const plan = candidates(basePrefs2, settings, { userId: 'u1', now, lastWaterAt: null, supplementSchedules: [], events: [ev] });
    expect(plan).toHaveLength(1);
    expect(plan[0].dedupeKey).toBe('u1|supplement|trigger|meal:breakfast|log-1');
    expect(plan[0].scheduledFor.toISOString()).toBe('2026-10-27T16:25:00.000Z');
    expect(plan[0].why).toContain('meal breakfast');
  });
  it('validates trigger and pause inputs', () => {
    expect(() => prefs.validateCategory('supplement', { triggerEvent: 'meal:midnight' })).toThrow('triggerEvent');
    expect(() => prefs.validateCategory('supplement', { triggerDelay: 999 })).toThrow('triggerDelay');
    expect(prefs.validateCategory('supplement', { triggerEvent: 'meal:breakfast', triggerDelay: 15 })).toEqual({ triggerEvent: 'meal:breakfast', triggerDelay: 15 });
    expect(() => prefs.validatePrefs({ pauseReason: 'lazy' })).toThrow('pauseReason');
    expect(prefs.validatePrefs({ pauseReason: 'vacation' })).toEqual({ pauseReason: 'vacation' });
  });
});

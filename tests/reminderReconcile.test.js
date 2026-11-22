// B3/B7 — reconciliation after travel / schedule changes.
const { reconcile, tz, candidates } = require('../src/services/reminders/scheduler');
const { wallTimeToUtc, localParts } = require('../src/services/reminders/time');

const ROW = (id, cat, key, at, payload) => ({ id, userId: 'u1', category: cat, dedupeKey: key, scheduledFor: at, payload, status: 'pending' });

function fakePrisma(prefsRow, pendingRows, settingsRows) {
  return {
    reminderPreference: { findUnique: async () => prefsRow },
    reminderInstance: {
      findMany: async () => pendingRows,
      update: async ({ where, data }) => Object.assign(pendingRows.find((r) => r.id === where.id), data),
      updateMany: async ({ where, data }) => { for (const r of pendingRows) if (where.id.in.includes(r.id)) Object.assign(r, data); return { count: where.id.in.length }; },
    },
    reminderCategorySetting: { findMany: async () => settingsRows },
  };
}

const PREFS_NY = { userId: 'u1', masterEnabled: true, timezoneMode: 'FOLLOW_DEVICE', lastDetectedTimezone: 'America/New_York', timezone: 'America/New_York', adaptiveEnabled: true };
const PREFS_DAL = { ...PREFS_NY, lastDetectedTimezone: 'America/Chicago' };
const LUNCH = { userId: 'u1', category: 'meal:lunch', enabled: true, source: 'manual', times: ['12:30'] };

describe('tz() — effective timezone policy', () => {
  test('FOLLOW_DEVICE prefers lastDetectedTimezone', () => {
    expect(tz(PREFS_DAL)).toBe('America/Chicago');
  });
  test('FIXED_TIMEZONE pins stored timezone regardless of detected zone', () => {
    expect(tz({ ...PREFS_DAL, timezoneMode: 'FIXED_TIMEZONE', timezone: 'America/New_York' })).toBe('America/New_York');
  });
  test('legacy locked rows fall back to homeTimezone', () => {
    expect(tz({ timezoneLocked: true, homeTimezone: 'Asia/Kolkata', timezone: 'America/New_York' })).toBe('Asia/Kolkata');
  });
});

describe('reconcile — Charlotte to Dallas', () => {
  const dayKey = '2026-06-15';
  const lunchKey = 'u1|meal:lunch|2026-06-15|12:30|0';
  const nyInstant = wallTimeToUtc(dayKey, 750, 'America/New_York'); // 12:30 ET = 16:30Z
  const dalInstant = wallTimeToUtc(dayKey, 750, 'America/Chicago'); // 12:30 CT = 17:30Z

  test('pending lunch shifts to 12:30 in the new device zone', async () => {
    const rows = [ROW('r1', 'meal:lunch', lunchKey, nyInstant)];
    const prisma = fakePrisma(PREFS_DAL, rows, [LUNCH]);
    const res = await reconcile(prisma, 'u1', new Date('2026-06-15T10:00:00Z'));
    expect(res.rescheduled).toBe(1);
    expect(res.expired).toBe(0);
    expect(rows[0].scheduledFor.toISOString()).toBe(dalInstant.toISOString());
  });

  test('Dallas back to Charlotte restores the Eastern instant', async () => {
    const rows = [ROW('r1', 'meal:lunch', lunchKey, dalInstant)];
    const prisma = fakePrisma(PREFS_NY, rows, [LUNCH]);
    const res = await reconcile(prisma, 'u1', new Date('2026-06-15T10:00:00Z'));
    expect(res.rescheduled).toBe(1);
    expect(rows[0].scheduledFor.toISOString()).toBe(nyInstant.toISOString());
  });

  test('FIXED_TIMEZONE does NOT move reminders when device travels', async () => {
    const prefs = { ...PREFS_DAL, timezoneMode: 'FIXED_TIMEZONE', timezone: 'America/New_York' };
    const rows = [ROW('r1', 'meal:lunch', lunchKey, nyInstant)];
    const res = await reconcile(fakePrisma(prefs, rows, [LUNCH]), 'u1');
    expect(res.rescheduled).toBe(0);
    expect(rows[0].scheduledFor.toISOString()).toBe(nyInstant.toISOString());
  });

  test('disabled category expires its pending instance', async () => {
    const rows = [ROW('r1', 'meal:lunch', lunchKey, nyInstant)];
    const res = await reconcile(fakePrisma(PREFS_DAL, rows, [{ ...LUNCH, enabled: false }]), 'u1');
    expect(res.expired).toBe(1);
    expect(rows[0].status).toBe('expired');
  });

  test('instant-based water-gap keys are left alone across zones', async () => {
    const gap = new Date('2026-06-15T15:00:00Z');
    const rows = [ROW('r1', 'water', `u1|water|gap|${gap.toISOString()}`, gap)];
    const res = await reconcile(fakePrisma(PREFS_DAL, rows, [{ userId: 'u1', category: 'water', enabled: true, source: 'manual' }]), 'u1');
    expect(res.rescheduled).toBe(0);
    expect(res.expired).toBe(0);
    expect(rows[0].scheduledFor.toISOString()).toBe(gap.toISOString());
  });

  test('idempotent — second reconcile is a no-op', async () => {
    const rows = [ROW('r1', 'meal:lunch', lunchKey, nyInstant)];
    const prisma = fakePrisma(PREFS_DAL, rows, [LUNCH]);
    await reconcile(prisma, 'u1');
    const res = await reconcile(prisma, 'u1');
    expect(res.rescheduled).toBe(0);
    expect(res.expired).toBe(0);
  });
});

describe('reminder time math — 12h edge cases via localParts', () => {
  test('midnight and noon land on the right UTC hour', () => {
    // 00:00 ET and 12:00 ET in June (EDT = UTC-4)
    expect(wallTimeToUtc('2026-06-15', 0, 'America/New_York').getUTCHours()).toBe(4);
    expect(wallTimeToUtc('2026-06-15', 720, 'America/New_York').getUTCHours()).toBe(16);
  });
  test('DST spring-forward: nonexistent 2:30 AM resolves deterministically', () => {
    const at = wallTimeToUtc('2026-03-08', 150, 'America/New_York');
    expect(at instanceof Date && !isNaN(at)).toBe(true);
  });
  test('DST fall-back: 1:30 AM picks one consistent instant', () => {
    const at = wallTimeToUtc('2026-11-01', 90, 'America/New_York');
    expect(localParts(at, 'America/New_York').minutes).toBe(90);
  });
});

const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const { getUserEnergySummary, localDayBounds, dedupedKcal } = require('../src/services/energySummary');
const { hashPassword } = require('../src/services/authService');

const prisma = getPrisma();
const S = `es${Date.now().toString(36)}`;
const H = 3600000;

let full, empty, wearable;

async function mkUser(tag, profile = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${tag}@test.dev`, passwordHash: await hashPassword('TestPass12345!'), emailVerifiedAt: new Date(),
      ...profile,
    },
  });
  return user;
}
const auth = id => ({ 'x-user-id': id });

beforeAll(async () => {
  // Complete profile: male 80kg 180cm age ~30 → BMR 1780, TDEE sedentary 2136
  full = await mkUser(`${S}-full`, {
    gender: 'male', currentWeightKg: 80, heightCm: 180, activityLevel: 'sedentary',
    dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC',
  });
  empty = await mkUser(`${S}-empty`, { timeZone: 'UTC' });
  wearable = await mkUser(`${S}-wear`, {
    gender: 'female', currentWeightKg: 60, heightCm: 165, activityLevel: 'light',
    dateOfBirth: new Date(Date.now() - 25 * 365.25 * 86400000), timeZone: 'UTC',
  });
});

describe('localDayBounds', () => {
  it('produces a 24h UTC day and a DST-correct day for America/New_York', () => {
    const utc = localDayBounds('2026-06-15', 'UTC');
    expect(utc.end - utc.start).toBe(24 * H);
    // 2026-03-08 is spring-forward: NY local day is 23h.
    const ny = localDayBounds('2026-03-08', 'America/New_York');
    expect(ny.end - ny.start).toBe(23 * H);
    // Fall-back day is 25h.
    const ny2 = localDayBounds('2026-11-01', 'America/New_York');
    expect(ny2.end - ny2.start).toBe(25 * H);
  });
});

describe('dedupedKcal', () => {
  const t = h => new Date(Date.UTC(2026, 5, 15, h));
  const s = Date.UTC(2026, 5, 15), e = s + 24 * H;
  it('sums non-overlapping records', () => {
    const r = dedupedKcal([{ startAt: t(8), endAt: t(9), kcal: 100 }, { startAt: t(10), endAt: t(11), kcal: 50 }], 'kcal', s, e);
    expect(r.kcal).toBe(150);
  });
  it('does not double-count overlapping records', () => {
    const r = dedupedKcal([{ startAt: t(8), endAt: t(10), kcal: 200 }, { startAt: t(9), endAt: t(11), kcal: 200 }], 'kcal', s, e);
    // First covers 8-10 fully; second only adds its uncovered hour (10-11) → 200 + 100.
    expect(r.kcal).toBeCloseTo(300, 5);
  });
  it('clips records spanning the day boundary', () => {
    const r = dedupedKcal([{ startAt: new Date(s - 12 * H), endAt: new Date(s + 12 * H), kcal: 480 }], 'kcal', s, e);
    expect(r.kcal).toBeCloseTo(240, 5); // only the in-day half counts
  });
  it('ignores negative/invalid metrics', () => {
    const r = dedupedKcal([{ startAt: t(8), endAt: t(9), kcal: -50 }, { startAt: t(9), endAt: t(10), kcal: 80 }], 'kcal', s, e);
    expect(r.kcal).toBe(80);
  });
});

describe('GET /energy/summary', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/energy/summary');
    expect(res.status).toBe(401);
  });

  it('rest day, no wearable: nonzero estimated resting + active, labeled estimate', async () => {
    const res = await request(app).get('/energy/summary?tz=UTC').set(auth(full.id));
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.version).toBe('energy-v1');
    expect(b.resting.fullDayKcal).toBe(1780);
    expect(b.resting.source).toBe('estimate:mifflin_st_jeor');
    expect(b.active.source).toBe('estimate:activity_factor');
    expect(b.expenditure.soFarKcal).toBeGreaterThan(0);
    expect(b.expenditure.projectedDayKcal).toBeGreaterThan(0);
    expect(b.dataGaps).toContain('no_active_energy_data');
    expect(b.dataGaps).toContain('no_resting_energy_data');
  });

  it('missing profile → null energy values + explicit gap, never zero', async () => {
    const res = await request(app).get('/energy/summary?tz=UTC').set(auth(empty.id));
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.resting.fullDayKcal).toBeNull();
    expect(b.expenditure.soFarKcal).toBeNull();
    expect(b.dataGaps.some(g => g.startsWith('profile_incomplete'))).toBe(true);
  });

  it('wearable resting+active records drive measured values with provider label', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = Date.parse(`${today}T00:00:00Z`);
    await prisma.healthEnergyRecord.createMany({ data: [
      { userId: wearable.id, provider: 'healthkit', sourceId: `${S}-r1`, startAt: new Date(dayStart), endAt: new Date(dayStart + 12 * H), restingKcal: 700, activeKcal: 0 },
      { userId: wearable.id, provider: 'healthkit', sourceId: `${S}-a1`, startAt: new Date(dayStart), endAt: new Date(dayStart + 12 * H), activeKcal: 320 },
    ]});
    const res = await request(app).get(`/energy/summary?date=${today}&tz=UTC`).set(auth(wearable.id));
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.resting.source).toBe('wearable:healthkit');
    expect(b.active.source).toBe('wearable:healthkit');
    expect(b.active.soFarKcal).toBe(320);
    expect(b.resting.soFarKcal).toBe(700);
    // resting extrapolated to full day over covered 12h → ~1400
    expect(b.resting.fullDayKcal).toBeCloseTo(1400, -1);
    // expenditure so far = measured resting + measured active (never estimated + wearable summed)
    expect(b.expenditure.soFarKcal).toBe(1020);
  });

  it('two providers are never summed — winner is the better-covered one', async () => {
    const u = await mkUser(`${S}-dual`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    const today = new Date().toISOString().slice(0, 10);
    const s0 = Date.parse(`${today}T00:00:00Z`);
    await prisma.healthEnergyRecord.createMany({ data: [
      { userId: u.id, provider: 'healthkit', sourceId: `${S}-hk`, startAt: new Date(s0), endAt: new Date(s0 + 10 * H), activeKcal: 400 },
      { userId: u.id, provider: 'fitbit', sourceId: `${S}-fb`, startAt: new Date(s0), endAt: new Date(s0 + 2 * H), activeKcal: 150 },
    ]});
    const res = await request(app).get(`/energy/summary?date=${today}&tz=UTC`).set(auth(u.id));
    expect(res.body.active.soFarKcal).toBe(400); // healthkit wins on coverage; fitbit NOT added
    expect(res.body.active.provider).toBe('healthkit');
  });

  it('overlapping same-provider records do not double count', async () => {
    const u = await mkUser(`${S}-ov`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    const today = new Date().toISOString().slice(0, 10);
    const s0 = Date.parse(`${today}T00:00:00Z`);
    await prisma.healthEnergyRecord.createMany({ data: [
      { userId: u.id, provider: 'healthkit', sourceId: `${S}-o1`, startAt: new Date(s0 + 8 * H), endAt: new Date(s0 + 10 * H), activeKcal: 200 },
      { userId: u.id, provider: 'healthkit', sourceId: `${S}-o2`, startAt: new Date(s0 + 9 * H), endAt: new Date(s0 + 11 * H), activeKcal: 200 },
    ]});
    const res = await request(app).get(`/energy/summary?date=${today}&tz=UTC`).set(auth(u.id));
    expect(res.body.active.soFarKcal).toBeCloseTo(300, 0); // 200 + uncovered-hour share
  });

  it('incomplete food logs produce a provisional balance, never a confirmed deficit', async () => {
    const u = await mkUser(`${S}-food`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    await prisma.foodLog.create({ data: { userId: u.id, foodName: 'toast', quantityG: 80, calories: 220, proteinG: 6, carbsG: 40, fatG: 4, mealType: 'breakfast' } });
    const res = await request(app).get('/energy/summary?tz=UTC').set(auth(u.id));
    const b = res.body;
    expect(b.intake.mealCount).toBe(1);
    expect(b.intake.completeness).toBe('partial');
    expect(b.balance.provisionalKcal).not.toBeNull();
    expect(b.balance.provisionalNote).toMatch(/Provisional/i);
    expect(b.balance.completedDayKcal).toBeNull();
  });

  it('no food logs → loggedKcal null, no provisional balance', async () => {
    const res = await request(app).get('/energy/summary?tz=UTC').set(auth(full.id));
    expect(res.body.intake.loggedKcal).toBeNull();
    expect(res.body.balance.provisionalKcal).toBeNull();
  });

  it('past day reports actual elapsed=1, no projection remainder', async () => {
    const res = await request(app).get('/energy/summary?date=2026-06-15&tz=UTC').set(auth(full.id));
    const b = res.body;
    expect(b.day.isToday).toBe(false);
    expect(b.day.elapsedFraction).toBe(1);
    expect(b.expenditure.soFarKcal).toBeCloseTo(b.resting.fullDayKcal + b.active.soFarKcal, 0);
  });

  it('users cannot read each other’s data (scoped by session user)', async () => {
    const res = await request(app).get('/energy/summary?tz=UTC').set(auth(empty.id));
    expect(res.body.dataGaps.some(g => g.startsWith('profile_incomplete'))).toBe(true);
    // same request as another user returns different, scoped data — no cross-talk
    const res2 = await request(app).get('/energy/summary?tz=UTC').set(auth(full.id));
    expect(res2.body.resting.fullDayKcal).toBe(1780);
  });

  it('Health Connect records resolve like HealthKit (resting + active, provider labeled)', async () => {
    const u = await mkUser(`${S}-hc`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    const today = new Date().toISOString().slice(0, 10);
    const s0 = Date.parse(`${today}T00:00:00Z`);
    await prisma.healthEnergyRecord.createMany({ data: [
      { userId: u.id, provider: 'health_connect', sourceId: `${S}-hcr`, startAt: new Date(s0), endAt: new Date(s0 + 12 * H), restingKcal: 650, activeKcal: 0 },
      { userId: u.id, provider: 'health_connect', sourceId: `${S}-hca`, startAt: new Date(s0), endAt: new Date(s0 + 12 * H), activeKcal: 280 },
    ]});
    const b = (await request(app).get(`/energy/summary?date=${today}&tz=UTC`).set(auth(u.id))).body;
    expect(b.resting.source).toBe('wearable:health_connect');
    expect(b.active.source).toBe('wearable:health_connect');
    expect(b.expenditure.soFarKcal).toBe(930);
  });

  it('provider switching: each day resolves its own best-covered provider independently', async () => {
    const u = await mkUser(`${S}-sw`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    const d1 = '2026-06-10', d2 = '2026-06-11';
    const s1 = Date.parse(`${d1}T00:00:00Z`), s2 = Date.parse(`${d2}T00:00:00Z`);
    await prisma.healthEnergyRecord.createMany({ data: [
      // Day 1: fitbit dominant; Day 2: healthkit dominant.
      { userId: u.id, provider: 'fitbit', sourceId: `${S}-sw1`, startAt: new Date(s1), endAt: new Date(s1 + 12 * H), activeKcal: 300 },
      { userId: u.id, provider: 'healthkit', sourceId: `${S}-sw2`, startAt: new Date(s1), endAt: new Date(s1 + 2 * H), activeKcal: 90 },
      { userId: u.id, provider: 'fitbit', sourceId: `${S}-sw3`, startAt: new Date(s2), endAt: new Date(s2 + 2 * H), activeKcal: 60 },
      { userId: u.id, provider: 'healthkit', sourceId: `${S}-sw4`, startAt: new Date(s2), endAt: new Date(s2 + 12 * H), activeKcal: 500 },
    ]});
    const b1 = (await request(app).get(`/energy/summary?date=${d1}&tz=UTC`).set(auth(u.id))).body;
    const b2 = (await request(app).get(`/energy/summary?date=${d2}&tz=UTC`).set(auth(u.id))).body;
    expect(b1.active.provider).toBe('fitbit');
    expect(b1.active.soFarKcal).toBe(300);
    expect(b2.active.provider).toBe('healthkit');
    expect(b2.active.soFarKcal).toBe(500);
  });

  it('stale wearable sync is flagged, not silently trusted', async () => {
    const u = await mkUser(`${S}-stale`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    const today = new Date().toISOString().slice(0, 10);
    const s0 = Date.parse(`${today}T00:00:00Z`);
    await prisma.healthEnergyRecord.create({ data: {
      userId: u.id, provider: 'fitbit', sourceId: `${S}-st1`,
      startAt: new Date(s0), endAt: new Date(s0 + 6 * H), activeKcal: 200,
      syncedAt: new Date(Date.now() - 48 * H), // last sync 2 days ago
    }});
    const b = (await request(app).get(`/energy/summary?date=${today}&tz=UTC`).set(auth(u.id))).body;
    expect(b.sync.stale).toBe(true);
    expect(b.dataGaps).toContain('stale_wearable_sync');
  });

  it('activity levels change the estimate — higher activity projects higher expenditure', async () => {
    const [sed, very] = await Promise.all([
      mkUser(`${S}-sed`, { gender: 'male', currentWeightKg: 80, heightCm: 180, activityLevel: 'sedentary', dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' }),
      mkUser(`${S}-va`, { gender: 'male', currentWeightKg: 80, heightCm: 180, activityLevel: 'very_active', dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' }),
    ]);
    const [a, b] = await Promise.all([
      request(app).get('/energy/summary?tz=UTC').set(auth(sed.id)),
      request(app).get('/energy/summary?tz=UTC').set(auth(very.id)),
    ]);
    // Same resting estimate; activity level only scales the active component.
    expect(a.body.resting.fullDayKcal).toBe(b.body.resting.fullDayKcal);
    expect(b.body.expenditure.tdeeEstimateKcal).toBeGreaterThan(a.body.expenditure.tdeeEstimateKcal);
  });

  it('trainer-set MacroGoal becomes the intake target with source label', async () => {
    const u = await mkUser(`${S}-goal`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    await prisma.macroGoal.create({ data: { userId: u.id, caloriesTarget: 2100, proteinTarget: 140, carbsTarget: 200, fatTarget: 70, source: 'trainer' } });
    const b = (await request(app).get('/energy/summary?tz=UTC').set(auth(u.id))).body;
    expect(b.target.intakeKcal).toBe(2100);
    expect(b.target.source).toBe('trainer');
  });

  it('energy ingestion rejects invalid metrics and stores valid resting+active records', async () => {
    process.env.FF_APPLE_HEALTH_SYNC = 'true';
    require('../src/services/featureFlags/service').resetCache();
    const u = await mkUser(`${S}-ing`, { gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC' });
    const today = new Date().toISOString().slice(0, 10);
    const s0 = Date.parse(`${today}T00:00:00Z`);
    const res = await request(app).post('/health-data/energy').set(auth(u.id)).send({ records: [
      // invalid: negative, reversed interval, unknown provider, absurd magnitude
      { provider: 'healthkit', sourceId: `${S}-bad1`, startAt: new Date(s0).toISOString(), endAt: new Date(s0 + H).toISOString(), activeKcal: -50 },
      { provider: 'healthkit', sourceId: `${S}-bad2`, startAt: new Date(s0 + 2 * H).toISOString(), endAt: new Date(s0).toISOString(), activeKcal: 100 },
      { provider: 'garmin-x', sourceId: `${S}-bad3`, startAt: new Date(s0).toISOString(), endAt: new Date(s0 + H).toISOString(), activeKcal: 100 },
      { provider: 'healthkit', sourceId: `${S}-bad4`, startAt: new Date(s0).toISOString(), endAt: new Date(s0 + H).toISOString(), activeKcal: 99999 },
      // valid: resting + active pair
      { provider: 'healthkit', sourceId: `${S}-ok1`, startAt: new Date(s0).toISOString(), endAt: new Date(s0 + 12 * H).toISOString(), activeKcal: 0, restingKcal: 600 },
      { provider: 'healthkit', sourceId: `${S}-ok2`, startAt: new Date(s0).toISOString(), endAt: new Date(s0 + 12 * H).toISOString(), activeKcal: 240 },
    ]});
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(6);
    expect(res.body.saved).toBe(2); // only the two valid records
    const b = (await request(app).get(`/energy/summary?date=${today}&tz=UTC`).set(auth(u.id))).body;
    expect(b.resting.source).toBe('wearable:healthkit');
    expect(b.active.soFarKcal).toBe(240);
    delete process.env.FF_APPLE_HEALTH_SYNC;
  });
});

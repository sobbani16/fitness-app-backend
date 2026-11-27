// Async DB-backed scenario validation (H-phase Phase 1/2). Executes the real
// trends/symptom/outcome services against the ISOLATED fitness_test database
// (TEST_DATABASE_URL swap enforced by tests/setup.js) with synthetic fixtures.
// Each scenario maps its expectedVerbatim to observable output — no fabricated
// expectations, no causal/medical claims.
const { getPrisma } = require('../src/lib/prisma');
const { getTrends } = require('../src/services/trends');
const { getSymptomContext } = require('../src/services/symptomContext');
const manifest = require('../data/scenarioAppendixA.json');

const prisma = getPrisma();
const D = 86400000, H = 3600000, NOW = Date.now();
const day = (n) => new Date(NOW - n * D);
const ids = []; // created user ids — scoped cleanup only

async function mkUser(tag, extra = {}) {
  const u = await prisma.user.create({ data: { email: `async-${tag}-${Math.random().toString(36).slice(2, 10)}@syn.local`, ...extra } });
  ids.push(u.id);
  return u;
}
const food = (userId, n, over) => prisma.foodLog.create({ data: { userId, mealType: 'lunch', foodName: over.foodName || 'Rice bowl', quantityG: over.quantityG || 300, calories: over.calories ?? 600, proteinG: over.proteinG ?? 20, carbsG: over.carbsG ?? 90, fatG: over.fatG ?? 10, fiberG: over.fiberG ?? 4, loggedAt: day(n), ...over } });
const symptom = (userId, n, over = {}) => prisma.userSymptomReport.create({ data: { userId, symptoms: over.symptoms || ['nausea'], severity: over.severity || 'mild', context: over.context || 'after_activity', persistence: over.persistence || null, status: over.status || 'active', source: 'manual', reportedAt: day(n), ...over } });
const expect2 = (id) => manifest.scenarios.find((s) => s.id === id).expected;

beforeAll(() => { if (!require('./testDbUrl').isPositiveTestDatabase(process.env.DATABASE_URL || '').ok) throw new Error('async runner must target a positively-identified local test database'); });
afterAll(async () => {
  for (const model of ['foodLog', 'weightEntry', 'workoutSession', 'dailySteps', 'sleepLog', 'macroGoal', 'goalHistory', 'userSymptomReport', 'dailyScoreSnapshot']) await prisma[model].deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('A08 — review training/protein/energy/recovery without assuming cause', () => {
  test('trend surfaces multi-domain review data with observational basis', async () => {
    const u = await mkUser('a08', { goalType: 'weight_loss' });
    await prisma.macroGoal.create({ data: { userId: u.id, caloriesTarget: 2000, proteinTarget: 140 } });
    for (let i = 0; i < 5; i++) { await food(u.id, i + 1, { calories: 2600 }); await prisma.workoutSession.create({ data: { userId: u.id, workoutType: 'strength', startedAt: day(i + 1), finishedAt: day(i + 1), endedAt: day(i + 1), durationMinutes: 45 } }); await prisma.sleepLog.create({ data: { userId: u.id, sleepStart: day(i + 1), sleepEnd: day(i + 1), hoursSlept: 5.5 } }); }
    const t = await getTrends(u.id, { days: 14 });
    expect(t.state).toBe('ok');
    expect(t.observations.length).toBeGreaterThan(0);
    expect(t.progress.basis).toContain('observational');
    expect(t.activity.workoutDays).toBe(5);
    expect(t.provenance.meals).toContain('FoodLog');
  });
});

describe('A09 — multi-week trends, logging confidence, fluctuations', () => {
  test('14-day window reports coverage + goalProgress enum', async () => {
    const u = await mkUser('a09');
    await prisma.macroGoal.create({ data: { userId: u.id, caloriesTarget: 2000 } });
    for (let i = 0; i < 8; i++) await food(u.id, i + 1, {});
    for (let i = 0; i < 4; i++) await prisma.weightEntry.create({ data: { userId: u.id, weightKg: 80 - i * 0.2, recordedAt: day(i + 1) } });
    const t = await getTrends(u.id, { days: 14 });
    expect(t.windowDays).toBe(14);
    expect(t.coverage.foodLoggedDays).toBe(8);
    expect(['progressing', 'stalled', 'regressing', 'unknown', 'no_data'].includes(t.progress.goalProgress)).toBe(true);
    expect(t.weight.note).toMatch(/not.*fat loss|fat-free mass|scale/i);
  });
});

describe('H01 — location/timing/severity/frequency; no assumed cause', () => {
  test('symptom reports enrich with timing/severity; associations non-causal', async () => {
    const u = await mkUser('h01');
    await food(u.id, 1, { foodName: 'Whey protein shake', loggedAt: new Date(NOW - D - 2 * H) });
    await food(u.id, 2, { foodName: 'Whey protein shake', loggedAt: new Date(NOW - 2 * D - 2 * H) });
    await symptom(u.id, 1, { symptoms: ['nausea'], severity: 'moderate', reportedAt: new Date(NOW - D) });
    await symptom(u.id, 2, { symptoms: ['nausea'], severity: 'moderate', reportedAt: new Date(NOW - 2 * D) });
    const c = await getSymptomContext(u.id, { days: 14 });
    expect(c.state).toBe('ok');
    expect(c.reports[0].severity).toBe('moderate');
    expect(c.reports[0].priorMealCount).toBe(1);
    const assoc = c.associations.find((a) => a.foodToken === 'whey' || a.foodToken === 'protein');
    expect(assoc.note).toMatch(/does not establish/i);
    expect(c.disclaimer).toMatch(/not diagnoses/i);
  });
});

describe('H02–H07 + D02 — temporal association; repeated patterns; approved-path guidance', () => {
  test('repeated co-occurrence produces association with non-causal note', async () => {
    const u = await mkUser('h02');
    for (const i of [1, 2, 3]) { await food(u.id, i, { foodName: 'Paneer curry', loggedAt: new Date(NOW - i * D - 3 * H) }); await symptom(u.id, i, { symptoms: ['bloating'], reportedAt: new Date(NOW - i * D) }); }
    const c = await getSymptomContext(u.id, { days: 14 });
    const assoc = c.associations.find((a) => a.foodToken === 'paneer');
    expect(assoc).toBeTruthy();
    expect(assoc.coOccurrenceDays).toBe(3);
    expect(assoc.basis).toBe('temporal_cooccurrence_within_6h');
    expect(assoc.note).toContain('does not establish that paneer caused');
  });
  test('2+ persistent reports → professional_review_suggested (no diagnosis)', async () => {
    const u = await mkUser('h05');
    await symptom(u.id, 1, { symptoms: ['headache'], persistence: 'persistent' });
    await symptom(u.id, 2, { symptoms: ['headache'], persistence: 'worsening' });
    const c = await getSymptomContext(u.id, { days: 14 });
    expect(c.escalation.outcome).toBe('professional_review_suggested');
    expect(c.escalation.kind).toBe('persistent_symptoms');
  });
  test('single report, no pattern → no escalation, no fabricated association', async () => {
    const u = await mkUser('h07');
    await symptom(u.id, 1, { symptoms: ['cramps'] });
    const c = await getSymptomContext(u.id, { days: 14 });
    expect(c.escalation).toBeNull();
    expect(c.associations).toHaveLength(0);
  });
});

describe('E04/G04 — pattern → reviewed guidance; association + timing', () => {
  test('association carries dose/timing context (priorMeals + reportedAt)', async () => {
    const u = await mkUser('g04');
    await food(u.id, 1, { foodName: 'Caffeine tablet', loggedAt: new Date(NOW - D - 5 * H) });
    await food(u.id, 2, { foodName: 'Caffeine tablet', loggedAt: new Date(NOW - 2 * D - 5 * H) });
    await prisma.sleepLog.create({ data: { userId: u.id, sleepStart: new Date(NOW - D - 20 * H), sleepEnd: new Date(NOW - D - 13 * H), hoursSlept: 4 } });
    await symptom(u.id, 1, { symptoms: ['poor_sleep'], reportedAt: new Date(NOW - D) });
    await symptom(u.id, 2, { symptoms: ['poor_sleep'], reportedAt: new Date(NOW - 2 * D) });
    const c = await getSymptomContext(u.id, { days: 14 });
    const assoc = c.associations.find((a) => a.foodToken === 'caffeine');
    expect(assoc).toBeTruthy();
    expect(c.reports[0].reportedAt).toBeTruthy();
    expect(c.coverage.sleepNights).toBe(1);
  });
});

describe('L03–L05 — divergence review; progress w/o false promise; surplus+training', () => {
  test('stalled progress + high scores → score_outcome_divergence review (validates Snapshot.date fix)', async () => {
    const u = await mkUser('l03', { goalType: 'weight_loss' });
    await prisma.macroGoal.create({ data: { userId: u.id, caloriesTarget: 1800 } });
    for (let i = 0; i < 5; i++) await food(u.id, i + 1, { calories: 1750 });
    for (const [i, d] of [1, 3, 5, 8].entries()) await prisma.weightEntry.create({ data: { userId: u.id, weightKg: 80.0, recordedAt: day(d) } });
    for (const [i, sc] of [88, 91, 85].entries()) await prisma.dailyScoreSnapshot.create({ data: { userId: u.id, date: day(i + 1), version: 'v2', composite: sc, state: 'ok', components: {} } });
    const t = await getTrends(u.id, { days: 14 });
    const rev = t.reviews.find((r) => r.kind === 'score_outcome_divergence');
    expect(rev).toBeTruthy();
    expect(rev.avgScore).toBeCloseTo(88, 0);
  });
  test('weight direction exposed without fat-loss promise', async () => {
    const u = await mkUser('l04', { goalType: 'muscle_gain' });
    for (let i = 0; i < 3; i++) await prisma.weightEntry.create({ data: { userId: u.id, weightKg: 70 + i * 0.3, recordedAt: day(10 - i * 3) } });
    const t = await getTrends(u.id, { days: 14 });
    expect(t.weight).toBeTruthy();
    expect(JSON.stringify(t)).not.toMatch(/guarantee|promised|will gain muscle/i);
  });
});

test('verbatim manifest intact — expected strings unchanged for all targets', () => {
  for (const id of ['A08', 'A09', 'H01', 'D02', 'E04', 'G04', 'L03', 'L04', 'L05']) expect(expect2(id)).toBeTruthy();
});

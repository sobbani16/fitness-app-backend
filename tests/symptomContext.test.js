// Sprint B symptom/context — observational associations, never causal.
const mockPrisma = {
  userSymptomReport: { findMany: jest.fn() },
  foodLog: { findMany: jest.fn() },
  workoutSession: { findMany: jest.fn() },
  sleepLog: { findMany: jest.fn() },
  dailyScoreSnapshot: { findMany: jest.fn() },
  weightEntry: { findMany: jest.fn() }, dailySteps: { findMany: jest.fn() },
  macroGoal: { findUnique: jest.fn() }, goalHistory: { findMany: jest.fn() }, user: { findUnique: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const { getSymptomContext } = require('../src/services/symptomContext');
const { getTrends } = require('../src/services/trends');
const day = (n) => new Date(Date.now() - n * 86400000);
const hAgo = (h) => new Date(Date.now() - h * 3600000);

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['userSymptomReport', 'foodLog', 'workoutSession', 'sleepLog', 'dailyScoreSnapshot', 'weightEntry', 'dailySteps']) mockPrisma[m].findMany.mockResolvedValue([]);
  mockPrisma.macroGoal.findUnique.mockResolvedValue(null);
  mockPrisma.goalHistory.findMany.mockResolvedValue([]);
  mockPrisma.user.findUnique.mockResolvedValue({ goalType: 'weight_loss' });
});

test('insufficient state with no reports', async () => {
  const s = await getSymptomContext('u1');
  expect(s.state).toBe('insufficient');
  expect(s.associations).toEqual([]);
});

test('co-occurrence counted on 2+ days → association with non-causal wording', async () => {
  mockPrisma.userSymptomReport.findMany.mockResolvedValue([
    { id: 'r1', symptoms: ['bloating'], persistence: null, status: 'active', reportedAt: hAgo(48) },
    { id: 'r2', symptoms: ['bloating'], persistence: null, status: 'active', reportedAt: hAgo(24) },
    { id: 'r3', symptoms: ['headache'], persistence: null, status: 'active', reportedAt: hAgo(1) },
  ]);
  mockPrisma.foodLog.findMany.mockResolvedValue([
    { foodName: 'Milk latte', loggedAt: hAgo(50) }, { foodName: 'Milk latte', loggedAt: hAgo(26) }, { foodName: 'Toast', loggedAt: hAgo(3) },
  ]);
  const s = await getSymptomContext('u1', { days: 14 });
  expect(s.state).toBe('ok');
  const milk = s.associations.find((a) => a.foodToken === 'milk');
  expect(milk).toBeTruthy();
  expect(milk.coOccurrenceDays).toBe(2);
  expect(milk.note).toMatch(/does not establish/i);
  expect(s.disclaimer).toMatch(/not diagnoses/i);
});

test('persistent reports → review escalation, not advice', async () => {
  mockPrisma.userSymptomReport.findMany.mockResolvedValue([
    { id: 'r1', symptoms: ['reflux'], persistence: 'persistent', status: 'active', reportedAt: hAgo(40) },
    { id: 'r2', symptoms: ['reflux'], persistence: 'worsening', status: 'active', reportedAt: hAgo(10) },
  ]);
  const s = await getSymptomContext('u1', { days: 14 });
  expect(s.escalation.outcome).toBe('professional_review_suggested');
});

test('trends exposes symptoms + divergence without breaking insufficient base', async () => {
  const t = await getTrends('u1', { days: 14 });
  expect(t.symptoms.state).toBe('insufficient');
  expect(t.provenance.symptoms).toBe('UserSymptomReport');
  expect(t.progress.divergence).toBeTruthy();
});

test('divergence: high scores + stalled progress → outcome_review in trends.reviews', async () => {
  mockPrisma.weightEntry.findMany.mockResolvedValue([{ recordedAt: day(10), weightKg: 80 }, { recordedAt: day(5), weightKg: 80 }, { recordedAt: day(0), weightKg: 80 }]);
  mockPrisma.dailyScoreSnapshot.findMany.mockResolvedValue([{ composite: 85 }, { composite: 82 }, { composite: 88 }]);
  const t = await getTrends('u1', { days: 14 });
  expect(t.progress.goalProgress).toBe('stalled'); // weight_loss goal + stable weight
  expect(t.reviews.find((r) => r.kind === 'score_outcome_divergence')).toBeTruthy();
});

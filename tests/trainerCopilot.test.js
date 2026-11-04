// Trainer Copilot (M15) — read-only consent-gated summaries + rule-based
// drafts that are never applied and never fabricated.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const svc = require('../src/services/trainerCopilot');

const TRAINER = { id: 't1', userId: 'trainer-user', verified: true, active: true, applicationStatus: 'approved' };
const REL = { id: 'rel1', trainerId: 't1', clientId: 'u1', status: 'active', startedAt: new Date(Date.now() - 30 * 86400000) };

function fakeDb({ consents = [], checkIns = [], intakes = [], plans = [], formChecks = [], workouts = [], sleep = [], steps = [], weights = [], relations = [REL] } = {}) {
  getPrisma.mockReturnValue({
    trainerProfile: { findUnique: jest.fn(async () => TRAINER) },
    trainerClient: {
      findUnique: jest.fn(async () => ({ ...REL, trainer: { userId: 'trainer-user', displayName: 'Coach' } })),
      findMany: jest.fn(async () => relations),
    },
    trainerClientConsent: { findMany: jest.fn(async () => consents.map(c => ({ category: c, status: 'granted' }))) },
    user: { findMany: jest.fn(async () => [{ id: 'u1', firstName: 'Ann', lastName: 'Lee' }]) },
    checkIn: { findMany: jest.fn(async () => checkIns) },
    baselineAssessment: { findMany: jest.fn(async () => intakes), findFirst: jest.fn(async () => intakes.sort((a, b) => b.version - a.version)[0] || null) },
    outcomePlan: {
      findMany: jest.fn(async () => plans),
      findFirst: jest.fn(async () => plans.find(p => p.status === 'active') || null),
    },
    formCheckRequest: { findMany: jest.fn(async () => formChecks) },
    workoutSession: { findMany: jest.fn(async () => workouts) },
    sleepLog: { findMany: jest.fn(async () => sleep) },
    dailySteps: { findMany: jest.fn(async () => steps) },
    weightEntry: { findMany: jest.fn(async () => weights) },
  });
}

const monday = () => { const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; };

describe('trainer copilot', () => {
  test('client list shows per-client status without raw data', async () => {
    fakeDb({ checkIns: [{ relationId: 'rel1', weekOf: monday(), reviewedAt: null }] });
    const r = await svc.listClients('trainer-user');
    expect(r.clients[0].clientName).toBe('Ann Lee');
    expect(r.clients[0].checkInThisWeek).toBe('awaiting_review');
    expect(r.clients[0].intakeStatus).toBe('none');
  });

  test('summary omits unconsented categories and reports them as not shared', async () => {
    fakeDb({ consents: ['workout_records'], workouts: [{ startedAt: new Date(), finishedAt: new Date() }] });
    const r = await svc.clientSummary('trainer-user', 'u1');
    expect(r.consent.granted).toEqual(['workout_records']);
    expect(r.consent.notShared).toContain('sleep_summaries');
    expect(r.activity.workoutsLast7d).toBe(1);
    expect(r.activity.avgSleepHours7d).toBeNull(); // hidden, not zero
    expect(r.note).toMatch(/notShared|not shared/i);
  });

  test('suggestions carry the AI-draft label, evidence and confirmation flag', async () => {
    fakeDb({
      intakes: [{ relationId: 'rel1', version: 1, status: 'submitted', updatedAt: new Date() }],
      checkIns: [{ id: 'c1', relationId: 'rel1', weekOf: monday(), energyLevel: 2, questions: 'Am I doing this right?', challenges: null, reviewedAt: null }],
      formChecks: [{ id: 'f1', exerciseName: 'Squat', status: 'submitted', submittedAt: new Date(), feedback: [] }],
    });
    const r = await svc.clientSuggestions('trainer-user', 'u1');
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) {
      expect(s.label).toBe('AI draft — requires trainer confirmation');
      expect(s.requiresTrainerConfirmation).toBe(true);
      expect(s.generatedBy).toBe('humai_copilot');
      expect(s.evidence.length).toBeGreaterThan(0);
    }
    expect(r.suggestions.find(s => s.kind === 'low_energy')).toBeTruthy();
    expect(r.suggestions.find(s => s.kind === 'form_check_review')).toBeTruthy();
    expect(r.draftDisclaimer).toMatch(/never applied automatically/i);
  });

  test('no data → no fabricated suggestions; data gaps reported', async () => {
    fakeDb({ checkIns: [{ id: 'c1', relationId: 'rel1', weekOf: monday(), reviewedAt: new Date() }] });
    const r = await svc.clientSuggestions('trainer-user', 'u1');
    const kinds = r.suggestions.map(s => s.kind);
    expect(kinds).not.toContain('low_energy');     // no energy data → no claim
    expect(kinds).not.toContain('training_gap');   // workouts not shared → no claim
    expect(kinds).toContain('intake_missing');     // absence of a record is itself known
    expect(r.dataCompleteness).toMatch(/not shared/i);
  });

  test('overdue open goals surface a review suggestion', async () => {
    fakeDb({
      checkIns: [{ id: 'c1', relationId: 'rel1', weekOf: monday(), reviewedAt: new Date() }],
      intakes: [{ relationId: 'rel1', version: 1, status: 'reviewed', updatedAt: new Date() }],
      plans: [{ id: 'p1', relationId: 'rel1', status: 'active', version: 1, goals: [{ id: 'g1', kind: 'strength', title: 'Squat 60kg', status: 'open', targetDate: new Date(Date.now() - 86400000), reviewIntervalDays: 7, progressSource: 'workout_records' }] }],
    });
    const r = await svc.clientSuggestions('trainer-user', 'u1');
    const s = r.suggestions.find(x => x.kind === 'goal_review_due');
    expect(s).toBeTruthy();
    expect(s.evidence[0]).toMatch(/Squat 60kg/);
  });
});

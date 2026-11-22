const request = require('supertest');
const fs = require('fs');
const path = require('path');

const mockPrisma = {
  supplement: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
  supplementEducation: { findUnique: jest.fn() },
  userSupplement: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  userRole: { findFirst: jest.fn() },
  supplementLog: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  supplementSchedule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  supplementDoseOccurrence: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  reminderPreference: { findUnique: jest.fn() },
  healthCondition: { findMany: jest.fn() },
  allergy: { findMany: jest.fn() },
  ingredientIntolerance: { findMany: jest.fn() },
  userHealthCondition: { findMany: jest.fn() },
  userAllergy: { findMany: jest.fn() },
  supplementInteractionRule: { findMany: jest.fn() },
  conditionRule: { findMany: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');
const schedSvc = require('../src/services/supplements/schedules');
const { guidanceFor } = require('../src/services/supplements/timingGuidance');

beforeEach(() => jest.clearAllMocks());

const UID = 'u-1';
const auth = (req) => req.set('x-user-id', UID);

// ---------------------------------------------------------------- dataset --
describe('Research dataset integrity', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/imports/humai_supplement_research_seed_v1.json'), 'utf8'));
  const items = seed.items || seed.supplements || [];

  it('contains 207 items with expected staged actions', () => {
    expect(items.length).toBe(207);
    const counts = {};
    for (const i of items) counts[i.import_action] = (counts[i.import_action] || 0) + 1;
    expect(counts).toEqual({ ENRICH_EXISTING: 34, ADD_CANDIDATE: 88, REVIEW_ONLY: 85 });
  });

  it('marks every item as unreviewed research draft', () => {
    expect(items.every(i => i.review_status === 'UNREVIEWED_RESEARCH_DRAFT')).toBe(true);
  });

  it('imports 47 safety rules, none approved', () => {
    const rules = seed.safety_rules_draft || seed.safety_rules || seed.safetyRules || [];
    expect(rules.length).toBe(47);
    expect(rules.every(r => r.approved === false)).toBe(true);
  });

  it('catalog CSV mirrors the JSON item count', () => {
    const csv = fs.readFileSync(path.join(__dirname, '..', 'data/imports/humai_supplement_catalog_207.csv'), 'utf8');
    const rows = csv.trim().split('\n').length - 1;
    expect(rows).toBe(207);
  });
});

// --------------------------------------------------------- timing guidance --
describe('guidanceFor', () => {
  it('WITH_FAT_MEAL is a convenience suggestion that maps to a meal anchor', () => {
    const g = guidanceFor({ timingCode: 'WITH_FAT_MEAL' });
    expect(g.required).toBe('optional');
    expect(g.scheduleRelation).toBe('WITH_MEAL');
    expect(g.autoScheduleAllowed).toBe(true);
    expect(g.userConfirmationRequired).toBe(true);
  });

  it('LABEL_DEPENDENT strength never auto-schedules', () => {
    const g = guidanceFor({ timingCode: 'WITH_MEAL', timingStrength: 'LABEL_DEPENDENT' });
    expect(g.autoScheduleAllowed).toBe(false);
    expect(g.needsClarification).toBe(true);
    expect(g.confidence).toBe('none');
  });

  it('FOLLOW_LABEL stays uncertain and unschedulable', () => {
    const g = guidanceFor({ timingCode: 'FOLLOW_LABEL' });
    expect(g.required).toBe('uncertain');
    expect(g.autoScheduleAllowed).toBe(false);
    expect(g.scheduleRelation).toBe('CUSTOM');
  });

  it('unknown codes fall back to ANY_TIME', () => {
    const g = guidanceFor({ timingCode: 'NOT_A_CODE' });
    expect(g.timingCode).toBe('NOT_A_CODE'); // echoes input; copy falls back
    expect(g.scheduleRelation).toBe('ANY_TIME');
  });

  it('NO_AUTO_SCHEDULE anchor blocks auto-scheduling even for normal codes', () => {
    const g = guidanceFor({ timingCode: 'ANY_TIME', relativeAnchor: 'NO_AUTO_SCHEDULE' });
    expect(g.autoScheduleAllowed).toBe(false);
  });
});

// ---------------------------------------------------- schedule validation --
describe('validateScheduleInput', () => {
  it('accepts a valid fixed-time daily schedule', () => {
    const { errors, data } = schedSvc.validateScheduleInput({ frequency: 'daily', timingRelation: 'FIXED_TIME', reminderTime: '8:05', doseAmount: 5, doseUnit: 'g' });
    expect(errors).toEqual([]);
    expect(data.reminderTime).toBe('08:05');
    expect(data.doseAmount).toBe(5);
  });

  it('WITH_BREAKFAST auto-fills the meal anchor', () => {
    const { errors, data } = schedSvc.validateScheduleInput({ timingRelation: 'WITH_BREAKFAST', fallbackTime: '09:00' });
    expect(errors).toEqual([]);
    expect(data.mealAnchor).toBe('breakfast');
  });

  it('AFTER_WORKOUT sets workoutAnchor', () => {
    const { data } = schedSvc.validateScheduleInput({ timingRelation: 'AFTER_WORKOUT', fallbackTime: '18:00' });
    expect(data.workoutAnchor).toBe(true);
  });

  it('rejects bad daysOfWeek, doseUnit, snooze, and times', () => {
    const { errors } = schedSvc.validateScheduleInput({ daysOfWeek: [7], doseUnit: 'pills', snoozeMinutes: 45, reminderTime: '25:00', mealAnchor: 'brunch' });
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });
});

// --------------------------------------------------------- dose actions ----
describe('actOnOccurrence', () => {
  const occ = (over = {}) => ({
    id: 'occ-1', userId: UID, status: 'PENDING', localDate: '2026-11-18', doseAmount: 5, doseUnit: 'g',
    userSupplementId: 'us-1', timezone: 'UTC',
    userSupplement: { supplement: { name: 'Creatine', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 } },
    ...over,
  });

  it('taken marks the occurrence and writes exactly one log', async () => {
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ());
    mockPrisma.supplementLog.findUnique.mockResolvedValue(null);
    mockPrisma.supplementLog.create.mockImplementation(async ({ data }) => ({ id: 'log-1', ...data }));
    mockPrisma.supplementDoseOccurrence.update.mockImplementation(async ({ data }) => ({ ...occ(), ...data }));
    mockPrisma.userSupplement.update.mockResolvedValue({});

    const res = await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'taken', { source: 'notification' });
    expect(res.status).toBe(200);
    expect(res.occurrence.status).toBe('TAKEN');
    expect(res.log.occurrenceId).toBe('occ-1');
    expect(res.log.idempotencyKey).toBe('taken:occ-1');
    expect(res.log.amount).toBe(5);
    expect(res.log.unit).toBe('g');
  });

  it('repeating taken is idempotent — no second log', async () => {
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ({ status: 'TAKEN' }));
    mockPrisma.supplementLog.findFirst.mockResolvedValue({ id: 'log-1' });
    const res = await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'taken', {});
    expect(res.idempotent).toBe(true);
    expect(mockPrisma.supplementLog.create).not.toHaveBeenCalled();
  });

  it('skipped persists and later non-taken actions do not reopen it', async () => {
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ());
    mockPrisma.supplementDoseOccurrence.update.mockImplementation(async ({ data }) => ({ ...occ(), ...data }));
    const res = await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'skipped', {});
    expect(res.occurrence.status).toBe('SKIPPED');

    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ({ status: 'SKIPPED' }));
    const again = await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'snoozed', {});
    expect(again.idempotent).toBe(true);
    expect(again.occurrence.status).toBe('SKIPPED');
  });

  it('snoozed sets snoozeUntil and revives back to PENDING', async () => {
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ());
    mockPrisma.supplementDoseOccurrence.update.mockImplementation(async ({ data }) => ({ ...occ(), ...data }));
    const res = await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'snoozed', { minutes: 15 });
    expect(res.occurrence.status).toBe('SNOOZED');
    expect(res.occurrence.snoozeUntil.getTime()).toBeGreaterThan(Date.now());

    mockPrisma.supplementDoseOccurrence.updateMany.mockResolvedValue({ count: 1 });
    const revived = await schedSvc.reviveSnoozed(mockPrisma, new Date(Date.now() + 16 * 60000));
    expect(revived).toBe(1);
    expect(mockPrisma.supplementDoseOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'SNOOZED', snoozeUntil: { lte: expect.any(Date) } },
      data: { status: 'PENDING', snoozeUntil: null },
    }));
  });

  it('rejects foreign occurrences and bad actions', async () => {
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ({ userId: 'other-user' }));
    expect((await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'taken', {})).status).toBe(404);
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue(occ());
    expect((await schedSvc.actOnOccurrence(mockPrisma, UID, 'occ-1', 'ate-it', {})).status).toBe(400);
  });
});

// ------------------------------------------------------------- routes -------
describe('supplement v2 routes', () => {
  it('POST /supplements/personal requires auth', async () => {
    const res = await request(app).post('/supplements/personal').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('POST /supplements/mine/:id/schedules validates ownership and input', async () => {
    mockPrisma.userSupplement.findUnique.mockResolvedValue({ id: 'us-1', userId: 'other' });
    const foreign = await auth(request(app).post('/supplements/mine/us-1/schedules')).send({});
    expect(foreign.status).toBe(404);

    mockPrisma.userSupplement.findUnique.mockResolvedValue({ id: 'us-1', userId: UID, supplementId: 's-1', doseAmount: 5, doseUnit: 'g', supplement: { name: 'Creatine' } });
    const invalid = await auth(request(app).post('/supplements/mine/us-1/schedules')).send({ timingRelation: 'FIXED_TIME' });
    expect(invalid.status).toBe(400);

    mockPrisma.supplementSchedule.create.mockImplementation(async ({ data }) => ({ id: 'sc-1', ...data }));
    mockPrisma.reminderPreference.findUnique.mockResolvedValue({ timezone: 'America/Los_Angeles' });
    mockPrisma.supplementDoseOccurrence.createMany.mockResolvedValue({ count: 5 });
    const ok = await auth(request(app).post('/supplements/mine/us-1/schedules'))
      .send({ frequency: 'daily', timingRelation: 'FIXED_TIME', reminderTime: '08:00', doseUnit: 'g', doseAmount: 5 });
    expect(ok.status).toBe(201);
    expect(ok.body.schedule.userId).toBe(UID);
    expect(ok.body.schedule.reminderTime).toBe('08:00');
  });

  it('PUT /supplements/schedules/:id regenerates future occurrences only', async () => {
    mockPrisma.supplementSchedule.findUnique.mockResolvedValue({ id: 'sc-1', userId: UID });
    mockPrisma.supplementSchedule.update.mockImplementation(async ({ data }) => ({ id: 'sc-1', userId: UID, ...data }));
    mockPrisma.supplementDoseOccurrence.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.reminderPreference.findUnique.mockResolvedValue(null);
    mockPrisma.supplementDoseOccurrence.createMany.mockResolvedValue({ count: 2 });
    const res = await auth(request(app).put('/supplements/schedules/sc-1')).send({ frequency: 'daily', timingRelation: 'FIXED_TIME', reminderTime: '09:00' });
    expect(res.status).toBe(200);
    const cancelCall = mockPrisma.supplementDoseOccurrence.updateMany.mock.calls[0][0];
    expect(cancelCall.where.status).toBe('PENDING');
    expect(cancelCall.data.status).toBe('CANCELLED');
  });

  it('POST /supplements/doses/:id/action rejects another user\'s dose', async () => {
    mockPrisma.supplementDoseOccurrence.findUnique.mockResolvedValue({ id: 'occ-9', userId: 'stranger', status: 'PENDING' });
    const res = await auth(request(app).post('/supplements/doses/occ-9/action')).send({ action: 'taken' });
    expect(res.status).toBe(404);
  });

  it('GET /supplements/safety returns the engine payload', async () => {
    mockPrisma.userSupplement.findMany.mockResolvedValue([]);
    mockPrisma.healthCondition.findMany.mockResolvedValue([]);
    mockPrisma.allergy.findMany.mockResolvedValue([]);
    mockPrisma.ingredientIntolerance.findMany.mockResolvedValue([]);
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([]);
    mockPrisma.userAllergy.findMany.mockResolvedValue([]);
    mockPrisma.supplementInteractionRule.findMany.mockResolvedValue([]);
    mockPrisma.conditionRule.findMany.mockResolvedValue([]);
    const res = await auth(request(app).get('/supplements/safety'));
    expect(res.status).toBe(200);
    expect(res.body.disclaimers[0]).toMatch(/does not mean/i);
  });
});

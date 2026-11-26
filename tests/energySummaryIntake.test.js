// HUM-49 Workstream H: energy summary distinguishes unknown logged calories.
// Mixed → measured subtotal; all-unknown → null; measured zero → 0; legacy
// snapshot-less rows measured. Provisional balance withheld on any unknown.
const { getUserEnergySummary } = require('../src/services/energySummary');

const DAY = '2026-11-10';
const NOW = new Date('2026-11-10T20:00:00Z'); // mid-day in UTC tz
const user = {
  id: 'u1', dateOfBirth: new Date('1990-01-01'), gender: 'female', heightCm: 165,
  currentWeightKg: 70, goalType: 'maintain', activityLevel: 'moderate', timeZone: 'UTC',
};

const db = (foodLogs) => ({
  user: { findUnique: async () => user },
  reminderPreference: { findUnique: async () => null },
  macroGoal: { findUnique: async () => ({ caloriesTarget: 2000, source: 'custom' }) },
  healthEnergyRecord: { findMany: async () => [] },
  foodLog: { findMany: async () => foodLogs },
});

const log = (calories, extra = {}) => ({ calories, loggedAt: new Date('2026-11-10T12:00:00Z'), ...extra });
const snapUnknown = { nutrientUnknowns: ['calories'] };
const snapKnown = { nutrientUnknowns: [] };

describe('energy summary — unknown logged calories', () => {
  it('mixed intake: measured subtotal reported, counts split', async () => {
    const r = await getUserEnergySummary(db([log(600), log(0, { nutritionSnapshot: snapUnknown })]), 'u1', { date: DAY, now: NOW });
    expect(r.intake.loggedKcal).toBe(600); // measured subtotal only
    expect(r.intake.measuredLogCount).toBe(1);
    expect(r.intake.unknownLogCount).toBe(1);
    expect(r.intake.completeness).toBe('partial'); // whole-day meaning preserved
  });

  it('all-unknown intake: loggedKcal is null — there is no honest number', async () => {
    const r = await getUserEnergySummary(db([log(0, { nutritionSnapshot: snapUnknown }), log(0, { nutritionSnapshot: snapUnknown })]), 'u1', { date: DAY, now: NOW });
    expect(r.intake.loggedKcal).toBeNull();
    expect(r.intake.unknownLogCount).toBe(2);
  });

  it('measured zero is reported as zero, not null', async () => {
    const r = await getUserEnergySummary(db([log(0, { nutritionSnapshot: snapKnown })]), 'u1', { date: DAY, now: NOW });
    expect(r.intake.loggedKcal).toBe(0);
    expect(r.intake.unknownLogCount).toBe(0);
  });

  it('snapshot-less legacy rows count as measured (control)', async () => {
    const r = await getUserEnergySummary(db([log(450)]), 'u1', { date: DAY, now: NOW });
    expect(r.intake.loggedKcal).toBe(450);
    expect(r.intake.unknownLogCount).toBe(0);
  });

  it('provisional balance withheld when any meal has unknown calories — note explains why', async () => {
    const r = await getUserEnergySummary(db([log(600), log(0, { nutritionSnapshot: snapUnknown })]), 'u1', { date: DAY, now: NOW });
    expect(r.balance.provisionalKcal).toBeNull();
    expect(r.balance.provisionalNote).toMatch(/Withheld/);
    expect(r.balance.provisionalNote).toMatch(/unknown calories/);
  });

  it('provisional balance preserved for fully-measured intake incl. legacy rows', async () => {
    const r = await getUserEnergySummary(db([log(600), log(0, { nutritionSnapshot: snapKnown })]), 'u1', { date: DAY, now: NOW });
    expect(r.balance.provisionalKcal).not.toBeNull();
    expect(r.balance.provisionalNote).toMatch(/^Provisional/);
  });

  it('completed-day balance remains unset regardless', async () => {
    const r = await getUserEnergySummary(db([log(600)]), 'u1', { date: '2026-11-01', now: NOW });
    expect(r.balance.completedDayKcal).toBeNull();
  });
});

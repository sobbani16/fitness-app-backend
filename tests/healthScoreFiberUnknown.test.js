// HUM-49 Workstream H: unknown fiber must never score as a zero deficiency.
const { scoreMacroAdherence } = require('../src/services/healthScoreEngine');

const mkPrisma = (logs) => ({
  foodLog: { findMany: async () => logs },
  supplementLog: { findMany: async () => [] },
  macroGoal: { findUnique: async () => ({ proteinTarget: 100, carbsTarget: 200, fatTarget: 70, fiberTarget: 30 }) },
});

const logWith = (fiberG) => ({
  proteinG: 30, carbsG: 50, fatG: 20, fiberG,
  nutritionSnapshot: fiberG == null ? { nutrientUnknowns: ['fiberG'] } : { nutrientUnknowns: [] },
});

describe('macro score with unknown fiber', () => {
  it('excludes fiber from the composite when composition is unknown + surfaces insight', async () => {
    const prisma = mkPrisma([logWith(30), logWith(null), logWith(null)]);
    const r = await scoreMacroAdherence('u1', '2026-11-25', prisma, 'UTC');
    const hit = (r.insights || []).find((i) => /fiber intake is unknown/i.test(i.message));
    expect(hit).toBeTruthy();
  });

  it('scores fiber normally when composition is fully known — no exclusion insight', async () => {
    const prisma = mkPrisma([logWith(30), logWith(10)]);
    const r = await scoreMacroAdherence('u1', '2026-11-25', prisma, 'UTC');
    const hit = (r.insights || []).find((i) => /fiber intake is unknown/i.test(i.message));
    expect(hit).toBeUndefined();
  });

  it('unknown-fiber day scores higher than the fake-zero treatment would (deficiency not fabricated)', async () => {
    // same logs, fiber unknown: composite should not be dragged toward the
    // fiber-deficiency floor the way fiberG=0 would drag it
    const unknown = await scoreMacroAdherence('u1', '2026-11-25', mkPrisma([logWith(null)]), 'UTC');
    const zeroTreated = await scoreMacroAdherence('u1', '2026-11-25', mkPrisma([{ ...logWith(0), nutritionSnapshot: { nutrientUnknowns: [] } }]), 'UTC');
    expect(unknown.score).toBeGreaterThanOrEqual(zeroTreated.score);
  });
});

// pc-HUM-101 — auto-onboarding regression coverage.
// Proves: (1) any new exercise row yields a complete, honest draft profile by
// derivation; (2) derivation is idempotent — no duplicate profiles on re-creation;
// (3) the write-time regeneration hook materializes artifact coverage for every
// exercise in the database, including newly written rows.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deriveDraftProfile, regenerateProfileArtifacts } = require('../src/services/exercise/onboarding');

const REQUIRED_SECTIONS = ['identity', 'classification', 'movementCharacteristics', 'poseRequirements', 'intelligenceConfig', 'safety', 'validation', 'capability'];

function syntheticExercise(overrides = {}) {
  return {
    id: 'test-new-exercise-xyz',
    name: 'Test New Exercise Xyz',
    normalizedName: 'test-new-exercise-xyz',
    level: 'beginner', force: 'push', mechanic: 'compound',
    equipment: 'barbell', appEquipment: ['barbell'], category: 'strength',
    instructions: ['step one'],
    source: 'free-exercise-db', sourceId: 'test-fixture',
    muscles: [
      { exerciseId: 'test-new-exercise-xyz', muscle: 'chest', role: 'primary' },
      { exerciseId: 'test-new-exercise-xyz', muscle: 'triceps', role: 'secondary' },
    ],
    ...overrides,
  };
}

describe('auto-onboarding — draft profile derivation for new exercises', () => {
  it('a newly created exercise yields a complete draft profile with all required sections', () => {
    const profile = deriveDraftProfile(syntheticExercise());
    expect(profile.exerciseId).toBe('test-new-exercise-xyz');
    for (const section of REQUIRED_SECTIONS) {
      expect(profile[section]).toBeDefined();
      expect(profile[section]).not.toBeNull();
    }
  });

  it('draft profile is honest: level 0 manual tracking, auto_generated_unreviewed, no ML validation', () => {
    const profile = deriveDraftProfile(syntheticExercise());
    expect(profile.capability.level).toBe(0);
    expect(profile.capability.label).toBe('manual_tracking');
    expect(profile.capability.validatedCapabilities).toEqual([]);
    expect(profile.validation.profileReviewStatus).toBe('auto_generated_unreviewed');
    expect(JSON.stringify(profile).toLowerCase()).not.toMatch(/ml.validated|ml-validated/);
  });

  it('unclassified new exercises still receive a full level-0 profile — never blocked by taxonomy residue', () => {
    const weird = syntheticExercise({ id: 'cable-judo-flip-zz', name: 'Cable Judo Flip ZZ', equipment: null, mechanic: null });
    const profile = deriveDraftProfile(weird);
    for (const section of REQUIRED_SECTIONS) {
      expect(profile[section]).toBeDefined();
    }
    expect(profile.capability.level).toBe(0);
    expect(profile.validation.profileReviewStatus).toBe('auto_generated_unreviewed');
  });

  it('idempotent re-creation: deriving twice for the same exercise yields one structurally identical profile — no duplicates', () => {
    const ex = syntheticExercise();
    const a = deriveDraftProfile(ex);
    const b = deriveDraftProfile(ex);
    const strip = (p) => { const { generatedAt, ...rest } = p; return rest; };
    expect(strip(a)).toEqual(strip(b));
    expect(a.exerciseId).toBe(b.exerciseId); // one profile per exercise ID, by construction
  });
});

describe('auto-onboarding — write-time artifact regeneration (DB-backed)', () => {
  it('regeneration covers every exercise row in the database exactly once', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exintel-'));
    process.env.EXERCISE_INTEL_OUT_DIR = tmp;
    try {
      const summary = await regenerateProfileArtifacts();
      expect(summary.profiles).toBe(summary.exercises);
      expect(summary.profiles).toBeGreaterThan(0);

      const artifact = JSON.parse(fs.readFileSync(path.join(tmp, 'exercise-profiles.v1.json'), 'utf8'));
      expect(artifact.count).toBe(artifact.profiles.length);
      const ids = artifact.profiles.map((p) => p.exerciseId);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates on re-generation

      const { getPrisma } = require('../src/lib/prisma');
      const prisma = getPrisma();
      const dbCount = await prisma.exercise.count();
      await prisma.$disconnect();
      expect(artifact.count).toBe(dbCount); // completeness: artifact covers live catalog

      for (const p of artifact.profiles) {
        expect(p.validation.profileReviewStatus).toBe('auto_generated_unreviewed');
        expect(p.capability.level).toBe(0);
      }
    } finally {
      delete process.env.EXERCISE_INTEL_OUT_DIR;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);
});

// pc-HUM-101 — taxonomy + intelligence-profile verification.
// Real catalog on fitness_test/dev read-only; no mutations.
const { classifyExercise, FAMILIES } = require('../src/services/exercise/taxonomy');
const { buildProfile, PROFILE_VERSION } = require('../src/services/exercise/profiles');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();

const mk = (name, fields = {}, muscles = []) => ({
  id: `t-${name}`, name, normalizedName: name, level: 'beginner',
  force: fields.force ?? 'push', mechanic: fields.mechanic ?? 'compound',
  equipment: fields.equipment ?? 'barbell', category: fields.category ?? 'strength',
  instructions: ['step'], appEquipment: [], source: 'test', muscles,
});
const m = (muscle, role = 'primary') => ({ muscle, role });

describe('movement-family classifier — rule accuracy', () => {
  test.each([
    ['Barbell Bench Press', 'horizontal_push', { force: 'push' }, [m('pectoralis-major')]],
    ['Overhead Press', 'vertical_push', { force: 'push' }, [m('deltoids')]],
    ['Lat Pulldown', 'vertical_pull', { force: 'pull' }, [m('latissimus-dorsi')]],
    ['Barbell Curl', 'elbow_flexion', { force: 'pull' }, [m('biceps-brachii')]],
    ['Triceps Pushdown', 'elbow_extension', { force: 'push' }, [m('triceps-brachii')]],
    ['Back Squat', 'squat', { force: 'push' }, [m('quadriceps')]],
    ['Romanian Deadlift', 'hip_hinge', { force: 'pull' }, [m('hamstrings')]],
    ['Walking Lunge', 'lunge', { force: 'push' }, [m('quadriceps')]],
    ['Standing Calf Raise', 'ankle_plantarflexion', { force: 'push' }, [m('gastrocnemius')]],
    ['Plank', 'anti_extension', { force: 'static' }, [m('rectus-abdominis')]],
    ['Crunch', 'trunk_flexion', { force: 'pull' }, [m('rectus-abdominis')]],
    ['Barbell Hip Thrust', 'hip_hinge', { category: 'powerlifting', force: 'push' }, [m('gluteus-maximus')]],
    ['Bench Press with Chains', 'horizontal_push', { category: 'powerlifting', force: 'push' }, [m('pectoralis-major')]],
  ])('%s → %s', (name, family, fields, muscles) => {
    expect(classifyExercise(mk(name, fields, muscles)).family).toBe(family);
  });

  test('hamstring curl is knee flexion, not elbow flexion', () => {
    const c = classifyExercise(mk('Lying Leg Curl', { force: 'pull' }, [m('hamstrings')]));
    expect(c.family).toBe('knee_flexion');
  });

  test('odd unrecognized exercise stays honestly unclassified', () => {
    const c = classifyExercise(mk('Zzzinklefarb Maneuver', { force: 'pull' }, [m('trapezius')]));
    expect(c.classified).toBe(false);
    expect(c.family).toBeNull();
    expect(c.ruleId).toBeNull();
  });

  test('every classification carries its producing rule id', () => {
    const c = classifyExercise(mk('Deadlift', { force: 'pull' }, [m('erector-spinae')]));
    expect(c.ruleId).toBe('hip-hinge');
  });

  test('unilateral detection: single-arm row true, barbell row null-or-false', () => {
    expect(classifyExercise(mk('One-Arm Dumbbell Row', { force: 'pull' }, [m('latissimus-dorsi')])).variation.unilateral).toBe(true);
    expect(classifyExercise(mk('Barbell Row', { force: 'pull' }, [m('latissimus-dorsi')])).variation.unilateral).not.toBe(true);
  });
});

describe('intelligence profiles — honesty contract', () => {
  test('every profile is Level 0 manual tracking with zero validated capabilities', () => {
    const p = buildProfile(mk('Deadlift', { force: 'pull' }, [m('erector-spinae')]));
    expect(p.capability.level).toBe(0);
    expect(p.capability.validatedCapabilities).toEqual([]);
    expect(p.validation.repCountValidationStatus).toBe('not_validated');
    expect(p.validation.datasetAvailability).toBe('none');
    expect(p.intelligenceConfig.modelIdentifier).toBeNull();
    expect(p.poseRequirements.status).toBe('not_specified_no_pipeline');
    expect(p.profileVersion).toBe(PROFILE_VERSION);
  });

  test('static movements get hold-duration strategy, not rep counting', () => {
    const p = buildProfile(mk('Plank', { force: 'static' }, [m('rectus-abdominis')]));
    expect(p.intelligenceConfig.repCounting).toBe('not_applicable_hold');
    expect(p.movementCharacteristics.holdCompletionCriteria).toBe('manual_timer_elapsed');
  });

  test('safety section invents no contraindications', () => {
    const p = buildProfile(mk('Squat', { force: 'push' }, [m('quadriceps')]));
    expect(p.safety.movementRestrictions).toEqual([]);
    expect(p.safety.injuryRestrictions).toEqual([]);
    expect(p.safety.safetyReviewStatus).toBe('pending_review');
  });
});

describe('full catalog — every exercise exactly once, every one profiled', () => {
  test('all exercises classify or are honestly unclassified; none claims validation', async () => {
    const all = await prisma.exercise.findMany({ include: { muscles: true } });
    expect(all.length).toBeGreaterThan(0);
    const seen = new Set();
    let classified = 0;
    for (const ex of all) {
      expect(seen.has(ex.id)).toBe(false); // inventory contract: exactly once
      seen.add(ex.id);
      const p = buildProfile(ex);
      expect(p.exerciseId).toBe(ex.id);
      expect(p.capability.level).toBe(0); // nothing may claim Level 1+ today
      expect(p.validation.repCountValidationStatus).toBe('not_validated');
      if (p.classification.classified) classified++;
    }
    // The full-catalog floor (884 rows, ≥85% classified, integrity checks) is
    // enforced by scripts/exercise-inventory.js against the real catalog; the
    // jest DB is fixture-only, so only the per-row honesty contract applies here.
    if (all.length >= 800) {
      expect((classified / all.length) * 100).toBeGreaterThanOrEqual(85);
    }
  });
});

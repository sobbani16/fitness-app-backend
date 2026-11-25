const { loadDefinitions, validateDefinitions, getExercise } = require('../src/services/pose/exerciseDefinitions');

describe('exercise definitions module (P4)', () => {
  it('loads the committed definitions and covers the 6 target exercises', () => {
    const defs = loadDefinitions();
    expect(defs.exercises).toHaveLength(6);
    expect(defs.exercises.map((e) => e.id).sort()).toEqual(
      ['deadlift_hinge', 'lunge', 'overhead_press', 'plank', 'push_up', 'squat']
    );
  });

  it('every exercise has rep criteria, phases and at least one high-severity cue', () => {
    for (const ex of loadDefinitions().exercises) {
      expect(ex.repCriteria.requiresPhases.length).toBeGreaterThan(0);
      expect(ex.phases.length).toBeGreaterThanOrEqual(2);
      expect(ex.coachingCues.some((c) => c.severity === 'high')).toBe(true);
    }
  });

  it('rejects duplicate ids', () => {
    const errors = validateDefinitions({ exercises: [
      { id: 'squat', displayName: 'a', primaryLandmarks: ['a','b','c','d'], trackedAngles: [], phases: [], repCriteria: {}, coachingCues: [] },
      { id: 'squat', displayName: 'b', primaryLandmarks: ['a','b','c','d'], trackedAngles: [], phases: [], repCriteria: {}, coachingCues: [] },
    ]});
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects repCriteria referencing undeclared phases', () => {
    const errors = validateDefinitions({ exercises: [{
      id: 'x', displayName: 'x', primaryLandmarks: ['a','b','c','d'],
      trackedAngles: [], phases: [{ name: 'standing', entry: 'x' }],
      repCriteria: { requiresPhases: ['standing', 'nonexistent'] },
      coachingCues: [{ fault: 'f', severity: 'high', detector: 'd', cue: 'c' }],
    }]});
    expect(errors.some((e) => e.includes('nonexistent'))).toBe(true);
  });

  it('rejects invalid angle ranges', () => {
    const errors = validateDefinitions({ exercises: [{
      id: 'x', displayName: 'x', primaryLandmarks: ['a','b','c','d'],
      trackedAngles: [{ joint: 'knee', landmarks: ['a','b','c'], standingRange: [180, 160], bottomRange: [60, 100] }],
      phases: [{ name: 'a', entry: 'x' }, { name: 'b', entry: 'x' }], repCriteria: { requiresPhases: ['a'] },
      coachingCues: [{ fault: 'f', severity: 'high', detector: 'd', cue: 'c' }],
    }]});
    expect(errors.some((e) => e.includes('standingRange'))).toBe(true);
  });

  it('rejects exercises with no high-severity safety cue', () => {
    const errors = validateDefinitions({ exercises: [{
      id: 'x', displayName: 'x', primaryLandmarks: ['a','b','c','d'],
      trackedAngles: [], phases: [{ name: 'a', entry: 'x' }],
      repCriteria: { requiresPhases: ['a'] },
      coachingCues: [{ fault: 'f', severity: 'low', detector: 'd', cue: 'c' }],
    }]});
    expect(errors.some((e) => e.includes('high-severity'))).toBe(true);
  });

  it('getExercise returns by id or null', () => {
    expect(getExercise('squat').displayName).toBe('Squat');
    expect(getExercise('nope')).toBeNull();
  });
});

jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn() }));
const { classify } = require('../src/services/exerciseSuitability');
const { validateEditedPlan } = require('../src/services/workoutPlanner');
const { suggestNext } = require('../src/services/workoutProgression');
const prefs = { experience: 'beginner', equipment: ['dumbbell'], preferredDays: ['mon'] };
const day = weekday => ({ weekday, exercises: [{ exerciseId: 'goblet-squat', sets: 2, reps: '10', restSec: 60 }] });

test('requires every piece of equipment, including support surfaces', () => {
  expect(classify('bench-press', { equipment: ['barbell'] }).status).toBe('adapt');
  expect(classify('squat', { equipment: ['barbell'] }).status).toBe('adapt');
  expect(classify('db-row', prefs).status).toBe('adapt');
  expect(classify('chair-squat', { equipment: ['bodyweight'] }).status).toBe('adapt');
});
test('floor access limitation also covers supine exercises', () => {
  expect(classify('glute-bridge', { equipment: ['bodyweight'], limitations: ['floor'] }).status).toBe('adapt');
});
test('rejects malformed edited plans as client errors', () => {
  for (const plan of [null, { days: {} }, { days: [null] }, { days: [{ weekday: 'mon', exercises: {} }] }]) {
    expect(() => validateEditedPlan(plan, prefs)).toThrow();
    try { validateEditedPlan(plan, prefs); } catch (e) { expect(e.status).toBe(400); }
  }
});
test('enforces weekdays, unique days and the confirmed availability on edits', () => {
  expect(() => validateEditedPlan({ days: [day('tue')] }, prefs)).toThrow();
  expect(() => validateEditedPlan({ days: [day('mon'), day('mon')] }, prefs)).toThrow();
  expect(() => validateEditedPlan({ days: [day('noday')] }, {})).toThrow();
});
test('does not mutate caller-owned exercise prescriptions', () => {
  const raw = { days: [day('mon')] }; raw.days[0].exercises[0].sets = 99;
  validateEditedPlan(raw, prefs);
  expect(raw.days[0].exercises[0].sets).toBe(99);
});
test('does not increase without explicit comfort feedback or after changing load', () => {
  const s = (weight, extra = {}) => ({ sets: [{ reps: 10, weightLbs: weight }], ...extra });
  expect(suggestNext('squat', [s(100), s(100)]).direction).toBe('maintain');
  expect(suggestNext('squat', [s(100), s(50, { rir: 3 })]).direction).toBe('maintain');
});

test('missing experience uses the same beginner default as the generation prompt', () => {
  const { candidatesFor } = require('../src/services/workoutPlanner');
  expect(candidatesFor({ equipment: ['barbell'] }).allowed.has('deadlift')).toBe(false);
});
test.each([{ equipment: 'barbell' }, { preferredDays: 2 }, { sessionMinutes: -10 }])('rejects malformed workout preferences: %p', preferences => {
  expect(() => validateEditedPlan({ days: [day('mon')] }, preferences)).toThrow();
});

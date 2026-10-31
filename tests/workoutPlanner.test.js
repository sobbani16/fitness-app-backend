jest.mock('../src/services/aiProvider', () => ({
  askJSON: jest.fn(),
}));
const { askJSON } = require('../src/services/aiProvider');
const { generateDraft, validateEditedPlan } = require('../src/services/workoutPlanner');

const homePrefs = { goal: 'muscle_gain', experience: 'beginner', location: 'home', equipment: ['dumbbell'], preferredDays: ['mon', 'thu'], sessionMinutes: 30 };

describe('generateDraft', () => {
  it('accepts AI output using only whitelisted IDs', async () => {
    askJSON.mockResolvedValue({
      days: [{ weekday: 'mon', focus: 'full body', exercises: [{ exerciseId: 'goblet-squat', sets: 3, reps: '8-10', restSec: 90, why: 'home dumbbells' }] }],
      summary: 'starter plan',
    });
    const r = await generateDraft('u1', homePrefs);
    expect(r.status).toBe('draft');
    expect(r.plan.days[0].exercises[0].exerciseId).toBe('goblet-squat');
    expect(r.catalogVersion).toMatch(/^exercise-catalog/);
  });

  it('strips invented exercise IDs and warns', async () => {
    askJSON.mockResolvedValue({
      days: [{ weekday: 'mon', exercises: [
        { exerciseId: 'dragon-flag-xl', sets: 4, reps: '10', restSec: 60, why: 'fake' },
        { exerciseId: 'goblet-squat', sets: 3, reps: '10', restSec: 60, why: 'ok' },
      ] }],
    });
    const r = await generateDraft('u1', homePrefs);
    expect(r.plan.days[0].exercises).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Removed 'dragon-flag-xl'/);
  });

  it('drops exercises unsuitable for the profile even if AI picks them', async () => {
    askJSON.mockResolvedValue({
      days: [{ weekday: 'mon', exercises: [
        { exerciseId: 'deadlift', sets: 3, reps: '5', restSec: 120, why: 'x' },
        { exerciseId: 'goblet-squat', sets: 2, reps: '10', restSec: 60, why: 'y' },
      ] }],
    });
    const r = await generateDraft('u1', homePrefs); // beginner + dumbbell only → deadlift not suitable
    expect(r.plan.days[0].exercises.map(e => e.exerciseId)).toEqual(['goblet-squat']);
  });

  it('clamps unsafe volume parameters', async () => {
    askJSON.mockResolvedValue({
      days: [{ weekday: 'mon', exercises: [{ exerciseId: 'goblet-squat', sets: 12, reps: '10', restSec: 900, why: 'x' }] }],
    });
    const r = await generateDraft('u1', homePrefs);
    const ex = r.plan.days[0].exercises[0];
    expect(ex.sets).toBe(6);
    expect(ex.restSec).toBe(300);
  });

  it('rejects a draft where nothing survives validation', async () => {
    askJSON.mockResolvedValue({ days: [{ weekday: 'mon', exercises: [{ exerciseId: 'fake', sets: 3, reps: '5', restSec: 60, why: 'x' }] }] });
    await expect(generateDraft('u1', homePrefs)).rejects.toMatchObject({ status: 502 });
  });

  it('422 when no exercises suit a hard-limitation profile', async () => {
    await expect(generateDraft('u1', { ...homePrefs, limitations: ['recent-injury'] }))
      .rejects.toMatchObject({ status: 422 });
    expect(askJSON).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.stringContaining('recent-injury'));
  });
});

describe('validateEditedPlan (pure path)', () => {
  it('re-validates user edits against the same rules', () => {
    const { plan, warnings } = validateEditedPlan(
      { days: [{ weekday: 'mon', exercises: [{ exerciseId: 'goblet-squat', sets: 99, reps: '10', restSec: 5, why: 'kept' }] }] },
      homePrefs,
    );
    expect(plan.days[0].exercises[0].sets).toBe(6);
    expect(plan.days[0].exercises[0].restSec).toBe(30);
    expect(warnings).toHaveLength(0);
  });
});

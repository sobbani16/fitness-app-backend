const { parseTranscript } = require('../src/services/voice/voiceParser');

const a = t => parseTranscript(t).actions;

describe('voiceParser', () => {
  test('water with units', () => {
    const r = a('Add 500 ml of water')[0];
    expect(r.intent).toBe('LOG_WATER');
    expect(r.entities.amountMl).toBe(500);
    expect(r.status).toBe('ready');
  });

  test('water liter + cup estimate', () => {
    expect(a('log 1 liter of water')[0].entities.amountMl).toBe(1000);
    const c = a('add a cup of water')[0];
    expect(c.entities.amountMl).toBe(240);
    expect(c.entities.estimated).toBe(true);
  });

  test('exercise sets with weight and reps', () => {
    const r = a('log 3 sets of bench press, 10 reps each, at 135 pounds')[0];
    expect(r.intent).toBe('LOG_EXERCISE_SET');
    expect(r.entities).toMatchObject({ exerciseName: 'bench press', sets: 3, reps: 10, weight: 135, weightUnit: 'lbs' });
    expect(r.status).toBe('ready');
  });

  test('kg weight unit preserved', () => {
    expect(a('2 sets of squats at 60 kg, 8 reps')[0].entities).toMatchObject({ weight: 60, weightUnit: 'kg', reps: 8 });
  });

  test('contextual "same weight" set', () => {
    const r = a('same weight, 12 more reps', ); // no ctx → needs_review
    expect(r[0].intent).toBe('LOG_EXERCISE_SET');
    expect(r[0].status).toBe('needs_review');
    const withCtx = parseTranscript('same weight, 12 more reps', { lastExercise: 'curl', lastWeight: 20, weightUnit: 'lbs' }).actions[0];
    expect(withCtx.entities).toMatchObject({ exerciseName: 'curl', reps: 12, weight: 20 });
    expect(withCtx.status).toBe('ready');
  });

  test('update last set', () => {
    const r = a('change my last set to 12 reps')[0];
    expect(r.intent).toBe('UPDATE_EXERCISE_SET');
    expect(r.entities.reps).toBe(12);
    expect(r.missing).toContain('set'); // no ctx.lastSetId
  });

  test('undo', () => {
    expect(a('undo that')[0].intent).toBe('UNDO_ACTION');
  });

  test('food multiple items with grams and servings', () => {
    const r = a('add 150 grams cooked rice and 100 grams chicken curry for lunch')[0];
    expect(r.intent).toBe('LOG_FOOD');
    expect(r.entities.mealType).toBe('lunch');
    expect(r.entities.items).toEqual([
      { name: 'cooked rice', grams: 150, unit: 'g' },
      { name: 'chicken curry', grams: 100, unit: 'g' },
    ]);
    expect(r.status).toBe('ready');
  });

  test('food without grams needs review', () => {
    const r = a('I ate two boiled eggs for breakfast')[0];
    expect(r.intent).toBe('LOG_FOOD');
    expect(r.entities.items[0]).toMatchObject({ name: 'boiled eggs', quantity: 2 });
    expect(r.status).toBe('needs_review');
  });

  test('multi-action utterance splits', () => {
    const acts = a('add 3 sets of squats at 135 pounds, 10 reps each, and log 500 ml water');
    expect(acts.map(x => x.intent)).toContain('LOG_EXERCISE_SET');
    expect(acts.map(x => x.intent)).toContain('LOG_WATER');
  });

  test('start workout', () => {
    const r = a('start my leg day workout')[0];
    expect(r.intent).toBe('START_WORKOUT');
    expect(r.entities.name).toBe('leg day');
  });

  test('supplement taken', () => {
    const r = a('mark my vitamin d supplement as taken')[0];
    expect(r.intent).toBe('MARK_SUPPLEMENT_TAKEN');
    expect(r.entities.name).toBe('vitamin d');
  });

  test('unknown intent', () => {
    expect(a('gibberish xyzzy')[0].intent).toBe('UNKNOWN_INTENT');
  });

  test('transcript truncated to 1000 chars', () => {
    expect(parseTranscript('x'.repeat(2000)).transcript.length).toBe(1000);
  });
});

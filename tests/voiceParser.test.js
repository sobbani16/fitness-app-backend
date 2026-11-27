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

describe('pc-HUM-91 food-routing precedence (acceptance matrix)', () => {
  test('"log 2 boiled eggs" is food, never exercise', () => {
    const r = a('log 2 boiled eggs')[0];
    expect(r.intent).toBe('LOG_FOOD');
    expect(r.entities.items[0]).toMatchObject({ name: 'boiled eggs', quantity: 2 });
    // count without verified serving stays needs_review — never fabricates grams
    expect(r.status).toBe('needs_review');
  });

  test('"log 2 dosas + cup sambar" splits on plus into two items', () => {
    const items = a('log 2 dosas + cup sambar')[0].entities.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'dosas', quantity: 2 });
    expect(items[1]).toMatchObject({ name: 'sambar', quantity: 1, unit: 'cup' });
  });

  test('"log rice yesterday" carries explicit dayOffset -1', () => {
    const r = a('log rice yesterday')[0];
    expect(r.intent).toBe('LOG_FOOD');
    expect(r.entities.dayOffset).toBe(-1);
    expect(r.entities.items[0].name).not.toMatch(/yesterday/i);
  });

  test('bare gram-led "150g cooked chicken" enters the food branch ready', () => {
    const r = a('150g cooked chicken')[0];
    expect(r.intent).toBe('LOG_FOOD');
    expect(r.entities.items[0]).toMatchObject({ name: 'cooked chicken', grams: 150 });
    expect(r.status).toBe('ready');
  });

  test('unit-led "log a cup of sambar" is food with quantity 1 cup', () => {
    const r = a('log a cup of sambar')[0];
    expect(r.intent).toBe('LOG_FOOD');
    expect(r.entities.items[0]).toMatchObject({ name: 'sambar', quantity: 1, unit: 'cup' });
  });

  test('exercise controls preserved: bare and structured exercise still LOG_EXERCISE_SET', () => {
    expect(a('log squats')[0].intent).toBe('LOG_EXERCISE_SET');
    expect(a('log squats')[0].entities.exerciseName).toBe('squats');
    expect(a('log 3 sets of squats')[0].intent).toBe('LOG_EXERCISE_SET');
    expect(a('log squats for 10 reps')[0].entities.reps).toBe(10);
    // count-led WITH reps structure stays exercise
    expect(a('log 2 pushups for 10 reps')[0].intent).toBe('LOG_EXERCISE_SET');
  });

  test('grocery/recipe precedence unaffected by food routing', () => {
    expect(a('add 2 eggs to my grocery list')[0].intent).toBe('ADD_GROCERY');
    expect(a('log the palak paneer recipe for dinner')[0].intent).toBe('LOG_RECIPE');
  });
});

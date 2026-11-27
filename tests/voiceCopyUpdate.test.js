// pc-HUM-91 — copy-meal + update-meal voice intents.
const { parseTranscript } = require('../src/services/voice/voiceParser');

describe('COPY_MEAL parsing', () => {
  it('"same breakfast as yesterday" → COPY_MEAL ready with dayOffset -1', () => {
    const a = parseTranscript('same breakfast as yesterday').actions[0];
    expect(a.intent).toBe('COPY_MEAL');
    expect(a.entities).toEqual({ mealType: 'breakfast', dayOffset: -1 });
    expect(a.status).toBe('ready');
  });
  it('"copy yesterday\'s lunch" → COPY_MEAL lunch', () => {
    const a = parseTranscript("copy yesterday's lunch").actions[0];
    expect(a.intent).toBe('COPY_MEAL');
    expect(a.entities.mealType).toBe('lunch');
  });
});
describe('UPDATE_MEAL parsing', () => {
  it('"change lunch rice to 200g" → UPDATE_MEAL with meal scoping', () => {
    const a = parseTranscript('change lunch rice to 200g').actions[0];
    expect(a.intent).toBe('UPDATE_MEAL');
    expect(a.entities).toEqual({ mealType: 'lunch', foodName: 'rice', grams: 200 });
  });
  it('unscoped variant still parses', () => {
    const a = parseTranscript('change rice to 250 grams').actions[0];
    expect(a.intent).toBe('UPDATE_MEAL');
    expect(a.entities.grams).toBe(250);
  });
});
describe('controls unchanged', () => {
  it('explicit food logging stays LOG_FOOD', () => {
    expect(parseTranscript('log 150g rice for lunch').actions[0].intent).toBe('LOG_FOOD');
  });
  it('exercise-set updates keep precedence over UPDATE_MEAL', () => {
    expect(parseTranscript('change last set to 10 reps').actions[0].intent).toBe('UPDATE_EXERCISE_SET');
  });
  it('"2 boiled eggs" and "rice yesterday" acceptance paths unchanged', () => {
    const eggs = parseTranscript('log 2 boiled eggs for breakfast').actions[0];
    expect(eggs.intent).toBe('LOG_FOOD');
    const rice = parseTranscript('log rice yesterday').actions[0];
    expect(rice.intent).toBe('LOG_FOOD');
    expect(rice.entities.dayOffset).toBe(-1);
  });
});

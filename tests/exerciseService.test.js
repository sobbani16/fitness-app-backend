const {
  suggestWeightFromHistory,
  autofillSetWeight,
  buildPrefill,
} = require('../src/services/exerciseService');

describe('exerciseService.suggestWeightFromHistory', () => {
  it('returns null when no previous session', () => {
    expect(suggestWeightFromHistory(null)).toBeNull();
  });

  it('returns null when previous session has no sets', () => {
    expect(suggestWeightFromHistory({ sets: [] })).toBeNull();
  });

  it('returns the weight of the last set performed', () => {
    const prev = {
      sets: [
        { reps: 10, weight: 40 },
        { reps: 8, weight: 45 },
        { reps: 6, weight: 50 },
      ],
    };
    expect(suggestWeightFromHistory(prev)).toBe(50);
  });
});

describe('exerciseService.autofillSetWeight', () => {
  it('returns null when no current sets and no override', () => {
    expect(autofillSetWeight([])).toBeNull();
  });

  it('reuses the weight from the most recent set', () => {
    expect(autofillSetWeight([{ reps: 10, weight: 60 }])).toBe(60);
  });

  it('honors explicit override', () => {
    expect(autofillSetWeight([{ reps: 10, weight: 60 }], 70)).toBe(70);
  });

  it('override of 0 is respected (bodyweight)', () => {
    expect(autofillSetWeight([{ reps: 10, weight: 60 }], 0)).toBe(0);
  });

  it('ignores non-finite override', () => {
    expect(autofillSetWeight([{ reps: 10, weight: 60 }], 'abc')).toBe(60);
  });
});

describe('exerciseService.buildPrefill', () => {
  it('fills blanks when no previous session', () => {
    expect(buildPrefill(null)).toEqual({
      suggestedWeight: null,
      lastSessionAt: null,
      lastSetCount: 0,
    });
  });

  it('returns suggested weight + metadata from last session', () => {
    const prev = {
      createdAt: '2026-04-20T12:00:00.000Z',
      sets: [
        { reps: 10, weight: 40 },
        { reps: 8, weight: 45 },
      ],
    };
    expect(buildPrefill(prev)).toEqual({
      suggestedWeight: 45,
      lastSessionAt: '2026-04-20T12:00:00.000Z',
      lastSetCount: 2,
    });
  });
});

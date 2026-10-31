const { EXERCISES, CATALOG_VERSION } = require('../src/services/exerciseCatalog');
const { classify, evaluateAll, RULE_VERSION } = require('../src/services/exerciseSuitability');

describe('exercise catalog', () => {
  it('contains the mobile exercise IDs with required metadata', () => {
    for (const id of ['bench-press', 'squat', 'deadlift', 'overhead-press', 'barbell-row', 'pull-up', 'push-up']) {
      const e = EXERCISES[id];
      expect(e).toBeDefined();
      for (const f of ['name', 'muscle', 'equipment', 'difficulty', 'pattern', 'position', 'balance', 'mobility', 'alternatives'])
        expect(e[f]).toBeDefined();
    }
  });
  it('alternatives reference real catalog entries', () => {
    for (const [id, e] of Object.entries(EXERCISES))
      for (const alt of e.alternatives) expect(EXERCISES[alt]).toBeDefined();
  });
  it('is versioned', () => expect(CATALOG_VERSION).toMatch(/^exercise-catalog\.v\d+$/));
});

describe('suitability rules', () => {
  const gymGoer = { experience: 'intermediate', equipment: ['barbell', 'bench', 'rack', 'dumbbell'] };
  it('classifies suitable exercise', () => {
    expect(classify('bench-press', gymGoer).status).toBe('suitable');
  });
  it('flags unknown exercise for review (no AI-invented IDs pass)', () => {
    expect(classify('ai-made-up-move', gymGoer).status).toBe('review');
  });
  it('adapts when required equipment is missing', () => {
    const home = { ...gymGoer, equipment: ['dumbbell'] };
    const r = classify('bench-press', home);
    expect(r.status).toBe('adapt');
    expect(r.alternatives).toContain('db-floor-press');
  });
  it('needs-info when equipment unknown', () => {
    expect(classify('bench-press', { experience: 'intermediate' }).status).toBe('needs-info');
  });
  it('advanced moves adapt for beginners', () => {
    const r = classify('deadlift', { experience: 'beginner', equipment: ['barbell'] });
    expect(r.status).toBe('adapt');
    expect(r.alternatives.length).toBeGreaterThan(0);
  });
  it('seated-only limitation excludes standing exercises', () => {
    const seated = { experience: 'intermediate', equipment: ['dumbbell', 'band', 'machine'], limitations: ['seated-only'] };
    expect(classify('squat', seated).status).toBe('adapt');
    expect(classify('lat-pulldown', seated).status).toBe('suitable');
  });
  it('recent injury always routes to qualified review — never auto-prescribed', () => {
    const r = classify('chair-squat', { experience: 'beginner', equipment: ['bodyweight'], limitations: ['recent-injury'] });
    expect(r.status).toBe('review');
    expect(r.reasons[0]).toMatch(/review/i);
  });
  it('balance limitation adapts high-balance moves', () => {
    const r = classify('lunge', { experience: 'intermediate', equipment: ['bodyweight'], limitations: ['balance'] });
    expect(r.status).toBe('adapt');
    expect(r.alternatives).toContain('split-squat');
  });
  it('is deterministic — same input, same output', () => {
    const a = classify('push-up', gymGoer);
    expect(classify('push-up', gymGoer)).toEqual(a);
  });
  it('evaluateAll covers an id set', () => {
    const out = evaluateAll(['squat', 'plank'], gymGoer);
    expect(Object.keys(out)).toEqual(['squat', 'plank']);
  });
  it('rules are versioned', () => expect(RULE_VERSION).toMatch(/^suitability\.v\d+$/));
});

const { dailyScore, adequacy, targetRange, moderation, pattern, CAPS } = require('../src/services/scoringV2');
const { resolve, OUTCOMES } = require('../src/services/decisionEngine');
const registry = require('../data/scenarioRegistry.json');
const T = { proteinG: 100, carbsG: 200, fatG: 60, fiberG: 28, caloriesMin: 1800, caloriesMax: 2200, calorieFloor: 1000 };
const fullDay = { nutrition: { proteinG: 100, carbsG: 200, fatG: 60, fiberG: 28, calories: 2000, targets: T },
  foodQuality: {}, activity: { weeklyMovementMin: 200, cardioSessions: 2, resistanceSessions: 2 }, sleep: { hoursSlept: 8 }, hydration: { waterMl: 2500 } };

describe('scenario registry', () => {
  it('contains exactly 120 scenarios A01–L10, ten per category', () => {
    expect(registry.scenarios).toHaveLength(120);
    const letters = 'ABCDEFGHIJKL'.split('');
    for (const L of letters) {
      const ids = registry.scenarios.filter(s => s.id.startsWith(L)).map(s => s.id);
      expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => `${L}0${i + 1}`.replace(`${L}010`, `${L}10`)));
    }
    expect(registry.scenarios.filter(s => s.priority === 'P0')).toHaveLength(50);
  });
});
describe('scoring primitives', () => {
  it('adequacy caps at target and never exceeds cap', () => {
    expect(adequacy(200, 100, 12).points).toBe(12); // no bonus for 2× protein
    expect(adequacy(50, 100, 12).points).toBe(6);
    expect(adequacy(null, 100, 12).state).toBe('no_data');
  });
  it('targetRange penalizes both below and above, suspends below floor', () => {
    expect(targetRange(2000, 1800, 2200, 40).points).toBe(40);
    expect(targetRange(900, 1800, 2200, 40, { floor: 1000 }).state).toBe('safety_suspended'); // A02
    expect(targetRange(2600, 1800, 2200, 40).points).toBeLessThan(40); // A06
  });
  it('moderation never treats unknown as zero', () => {
    expect(moderation(null, 50, 6).reason).toMatch(/not counted as zero/); // K07
    expect(moderation(40, 50, 6).points).toBe(6);
  });
  it('pattern gives weekly-adherence credit (rest day safe)', () => {
    expect(pattern(2, 2, 8).points).toBe(8); // F04
  });
});
describe('dailyScore invariants', () => {
  it('fixed caps sum to 100 and components never exceed', () => {
    expect(Object.values(CAPS).reduce((a, b) => a + b, 0)).toBe(100);
    const s = dailyScore(fullDay);
    for (const [k, c] of Object.entries(s.components)) expect(c.earned).toBeLessThanOrEqual(c.cap);
    expect(s.composite).toBeLessThanOrEqual(100);
  });
  it('zero logged meals = 0/40 nutrition, never implied fasting (K02)', () => {
    const s = dailyScore({ activity: fullDay.activity });
    expect(s.components.nutrition.earned).toBe(0);
    expect(s.components.nutrition.parts.protein.state).toBe('no_data');
    expect(s.composite).toBe(20); // activity only — steps alone cap at movement+…=20 max
  });
  it('suspension suppresses composite but keeps components', () => {
    const s = dailyScore(fullDay, { safetySuspension: 'hypoglycemia pathway' });
    expect(s.composite).toBeNull();
    expect(s.state).toBe('safety_suspended');
    expect(s.components.nutrition.earned).toBeGreaterThan(0);
  });
  it('PHO flag zeroes quality regardless of rounded trans label (C08)', () => {
    const s = dailyScore({ ...fullDay, foodQuality: { hasPartiallyHydrogenatedOil: true } });
    expect(s.components.foodQuality.earned).toBe(0);
  });
  it('walking alone cannot earn resistance credit (F01)', () => {
    const s = dailyScore({ activity: { weeklySteps: 90000, weeklyMovementMin: 300, cardioSessions: 3, resistanceSessions: 0 } });
    expect(s.components.activity.parts.resistance.points).toBe(0);
    expect(s.components.activity.earned).toBeLessThan(20);
  });
  it('fluid restriction marks hydration not_applicable, not zero-fail', () => {
    const s = dailyScore({ ...fullDay, hydration: { fluidRestricted: true } });
    expect(s.components.hydration.state).toBe('not_applicable');
    expect(s.components.hydration.earned).toBeNull();
  });
});
describe('decision engine priority', () => {
  it('escalation beats everything (H09)', () => {
    const r = resolve({ redFlags: ['blood_in_stool'], missingInputs: ['portion'] });
    expect(r.outcome).toBe(OUTCOMES.ESCALATION);
    expect(r.suppressOrdinaryCoaching).toBe(true);
  });
  it('life-stage beats medical triggers (J06)', () => {
    expect(resolve({ lifeStages: ['pregnancy'], medicalTriggers: ['conflicting_conditions'] }).outcome).toBe(OUTCOMES.REVIEW);
  });
  it('under-18 is blocked, not scored (J08)', () => {
    const r = resolve({ lifeStages: ['under_18'] });
    expect(r.outcome).toBe(OUTCOMES.REVIEW);
    expect(r.suppressOrdinaryCoaching).toBe(true);
  });
  it('conflicting conditions route to review (I10)', () => {
    expect(resolve({ medicalTriggers: ['conflicting_conditions'] }).outcome).toBe(OUTCOMES.REVIEW);
  });
  it('asks at most 3 questions when data weak (K03)', () => {
    const r = resolve({ missingInputs: ['a', 'b', 'c', 'd', 'e'], dataConfidence: 'partially_known' });
    expect(r.outcome).toBe(OUTCOMES.ASK);
    expect(r.questions).toHaveLength(3);
  });
  it('ordinary path falls through to feedback', () => {
    expect(resolve({}).outcome).toBe(OUTCOMES.FEEDBACK);
  });
});

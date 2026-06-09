// Tests for the Safety Engine: Ingredient Validator, Supplement Validator,
// Nutrition Validator, and the full Safety Pipeline.

const mockPrisma = {
  userHealthCondition: { findMany: jest.fn() },
  ingredientAttribute: { findMany: jest.fn() },
  supplementAttribute: { findMany: jest.fn() },
  supplementRule: { findMany: jest.fn() },
  safetyAuditLog: { create: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const { validateIngredients } = require('../src/services/safety/ingredientValidator');
const { validateSupplements } = require('../src/services/safety/supplementValidator');
const { validateMealNutrition } = require('../src/services/safety/nutritionValidator');

function conditionWithRules(name, rules) {
  return {
    userId: 'user-1',
    active: true,
    conditionId: `cond-${name}`,
    condition: {
      id: `cond-${name}`,
      name,
      conditionRules: rules,
    },
  };
}

beforeEach(() => jest.clearAllMocks());

// ============================================================================
// INGREDIENT VALIDATOR
// ============================================================================

describe('IngredientValidator', () => {
  it('returns safe=true when user has no conditions', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([]);
    const result = await validateIngredients('user-1', [{ name: 'Banana' }]);
    expect(result.safe).toBe(true);
    expect(result.safetyScore).toBe(100);
  });

  it('blocks HIGH_SUGAR ingredient for Type 2 Diabetes', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Type 2 Diabetes', [
        { attribute: 'HIGH_SUGAR', target: 'ingredient', action: 'block', reason: 'Spikes blood sugar' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'HIGH_SUGAR' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Candy', ingredientId: 'ing-1' },
    ]);
    expect(result.safe).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe('block');
    expect(result.violations[0].conditionName).toBe('Type 2 Diabetes');
  });

  it('warns GOITROGENIC for Hypothyroidism', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Hypothyroidism', [
        { attribute: 'GOITROGENIC', target: 'ingredient', action: 'warn', reason: 'May affect thyroid' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'GOITROGENIC' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Broccoli', ingredientId: 'ing-2' },
    ]);
    expect(result.safe).toBe(true); // warn != block
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe('warn');
  });

  it('blocks HIGH_POTASSIUM for CKD', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('CKD', [
        { attribute: 'HIGH_POTASSIUM', target: 'ingredient', action: 'block', reason: 'Dangerous with CKD' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'HIGH_POTASSIUM' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Banana', ingredientId: 'ing-3' },
    ]);
    expect(result.safe).toBe(false);
  });

  it('blocks HIGH_SODIUM for Hypertension', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Hypertension', [
        { attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'block', reason: 'Raises BP' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'HIGH_SODIUM' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Soy sauce', ingredientId: 'ing-4' },
    ]);
    expect(result.safe).toBe(false);
  });

  it('blocks CONTAINS_GLUTEN for Celiac Disease', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Celiac Disease', [
        { attribute: 'CONTAINS_GLUTEN', target: 'ingredient', action: 'block', reason: 'Celiac' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'CONTAINS_GLUTEN' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Wheat bread', ingredientId: 'ing-5' },
    ]);
    expect(result.safe).toBe(false);
    expect(result.violations[0].attribute).toBe('CONTAINS_GLUTEN');
  });

  it('blocks NUT allergen for Nut Allergy', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Nut Allergy', [
        { attribute: 'NUT', target: 'ingredient', action: 'block', reason: 'Allergen' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'NUT' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Almonds', ingredientId: 'ing-6' },
    ]);
    expect(result.safe).toBe(false);
  });

  it('blocks SHELLFISH allergen', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Shellfish Allergy', [
        { attribute: 'SHELLFISH', target: 'ingredient', action: 'block', reason: 'Allergen' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'SHELLFISH' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Shrimp', ingredientId: 'ing-7' },
    ]);
    expect(result.safe).toBe(false);
  });

  it('warns ACIDIC and SPICY for GERD', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('GERD', [
        { attribute: 'ACIDIC', target: 'ingredient', action: 'warn', reason: 'Triggers reflux' },
        { attribute: 'SPICY', target: 'ingredient', action: 'warn', reason: 'Worsens GERD' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'ACIDIC' },
      { attribute: 'SPICY' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Hot salsa', ingredientId: 'ing-8' },
    ]);
    expect(result.safe).toBe(true); // warns only
    expect(result.violations).toHaveLength(2);
  });

  it('handles multiple conditions on the same ingredient', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Type 2 Diabetes', [
        { attribute: 'HIGH_SUGAR', target: 'ingredient', action: 'block', reason: 'Blood sugar' },
      ]),
      conditionWithRules('Hypertension', [
        { attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'block', reason: 'BP' },
      ]),
    ]);
    mockPrisma.ingredientAttribute.findMany.mockResolvedValue([
      { attribute: 'HIGH_SUGAR' },
      { attribute: 'HIGH_SODIUM' },
    ]);
    const result = await validateIngredients('user-1', [
      { name: 'Sugary salty snack', ingredientId: 'ing-9' },
    ]);
    expect(result.safe).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.safetyScore).toBeLessThanOrEqual(50);
  });
});

// ============================================================================
// SUPPLEMENT VALIDATOR
// ============================================================================

describe('SupplementValidator', () => {
  it('returns safe=true with no conditions', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([]);
    mockPrisma.supplementAttribute.findMany.mockResolvedValue([]);
    mockPrisma.supplementRule.findMany.mockResolvedValue([]);
    const result = await validateSupplements('user-1', [{ name: 'Creatine', supplementId: 's-1' }]);
    expect(result.safe).toBe(true);
  });

  it('blocks HIGH_SODIUM supplement for Hypertension', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Hypertension', [
        { attribute: 'HIGH_SODIUM', target: 'supplement', action: 'block', reason: 'BP' },
      ]),
    ]);
    mockPrisma.supplementAttribute.findMany.mockResolvedValue([
      { attribute: 'HIGH_SODIUM' },
    ]);
    mockPrisma.supplementRule.findMany.mockResolvedValue([]);
    const result = await validateSupplements('user-1', [{ name: 'Electrolytes', supplementId: 's-2' }]);
    expect(result.safe).toBe(false);
  });

  it('warns THYROID_CAUTION for Hypothyroidism', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Hypothyroidism', [
        { attribute: 'THYROID_CAUTION', target: 'supplement', action: 'warn', reason: 'Thyroid interaction' },
      ]),
    ]);
    mockPrisma.supplementAttribute.findMany.mockResolvedValue([
      { attribute: 'THYROID_CAUTION' },
    ]);
    mockPrisma.supplementRule.findMany.mockResolvedValue([
      { conditionId: 'cond-Hypothyroidism', ruleType: 'timing', description: 'Take 4h apart from thyroid meds', gapHours: 4, conflictsWith: 'Levothyroxine', condition: { name: 'Hypothyroidism' } },
    ]);
    const result = await validateSupplements('user-1', [{ name: 'Calcium', supplementId: 's-3' }]);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.timingWarnings).toHaveLength(1);
    expect(result.timingWarnings[0].gapHours).toBe(4);
  });

  it('blocks DIABETES_CAUTION supplement', async () => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([
      conditionWithRules('Type 2 Diabetes', [
        { attribute: 'HIGH_SUGAR', target: 'supplement', action: 'block', reason: 'Blood sugar' },
      ]),
    ]);
    mockPrisma.supplementAttribute.findMany.mockResolvedValue([
      { attribute: 'HIGH_SUGAR' },
    ]);
    mockPrisma.supplementRule.findMany.mockResolvedValue([]);
    const result = await validateSupplements('user-1', [{ name: 'Mass Gainer', supplementId: 's-4' }]);
    expect(result.safe).toBe(false);
  });
});

// ============================================================================
// NUTRITION VALIDATOR
// ============================================================================

describe('NutritionValidator', () => {
  beforeEach(() => {
    mockPrisma.userHealthCondition.findMany.mockResolvedValue([]);
  });

  it('passes when nutrition is within targets', async () => {
    const result = await validateMealNutrition(
      'user-1',
      { ingredients: [], totalCalories: 500, totalProteinG: 40, totalCarbsG: 60, totalFatG: 15 },
      { caloriesTarget: 600, proteinTarget: 50, carbsTarget: 80, fatTarget: 25 },
    );
    expect(result.safe).toBe(true);
    expect(result.nutritionWarnings).toHaveLength(0);
  });

  it('warns on calorie excess', async () => {
    const result = await validateMealNutrition(
      'user-1',
      { ingredients: [], totalCalories: 900, totalProteinG: 40, totalCarbsG: 60, totalFatG: 15 },
      { caloriesTarget: 600, proteinTarget: 50, carbsTarget: 80, fatTarget: 25 },
    );
    expect(result.nutritionWarnings.some((w) => w.type === 'calories_excess')).toBe(true);
  });

  it('warns on low protein', async () => {
    const result = await validateMealNutrition(
      'user-1',
      { ingredients: [], totalCalories: 400, totalProteinG: 10, totalCarbsG: 60, totalFatG: 15 },
      { caloriesTarget: 600, proteinTarget: 50, carbsTarget: 80, fatTarget: 25 },
    );
    expect(result.nutritionWarnings.some((w) => w.type === 'protein_low')).toBe(true);
  });
});

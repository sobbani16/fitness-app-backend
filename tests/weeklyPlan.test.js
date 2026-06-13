const { computeAdjustment } = require('../src/services/weekly/calorieAdjustmentEngine');
const { adherenceStatus } = require('../src/services/weekly/adherenceEngine');
const { generateWeeklyMeals, generateShoppingList } = require('../src/services/weekly/weeklyDietGenerator');

describe('Adherence Engine', () => {
  it('excellent for 90%+', () => expect(adherenceStatus(92)).toBe('excellent'));
  it('good for 70-84%', () => expect(adherenceStatus(75)).toBe('good'));
  it('poor for 50-69%', () => expect(adherenceStatus(55)).toBe('poor'));
  it('very_poor for <50%', () => expect(adherenceStatus(30)).toBe('very_poor'));
});

describe('Calorie Adjustment Engine', () => {
  it('does NOT reduce calories when adherence < 70%', () => {
    const result = computeAdjustment({
      currentCalories: 2000, adherencePercent: 55,
      recoveryScore: 80, weightTrendKg: 0, weeksStalled: 3,
    });
    expect(result.adjustmentAmount).toBe(0);
    expect(result.reason).toBe('adherence_low');
    expect(result.explanation).toContain('adherence');
  });

  it('does NOT reduce when recovery is poor', () => {
    const result = computeAdjustment({
      currentCalories: 2000, adherencePercent: 90,
      recoveryScore: 40, weightTrendKg: 0, weeksStalled: 3,
    });
    expect(result.adjustmentAmount).toBe(0);
    expect(result.reason).toBe('recovery_poor');
  });

  it('maintains when weight loss is progressing', () => {
    const result = computeAdjustment({
      currentCalories: 2000, adherencePercent: 90,
      recoveryScore: 80, weightTrendKg: -0.8, weeksStalled: 0,
    });
    expect(result.adjustmentAmount).toBe(0);
    expect(result.reason).toBe('on_track');
    expect(result.explanation).toContain('0.8kg');
  });

  it('reduces gradually when stalled 2+ weeks', () => {
    const result = computeAdjustment({
      currentCalories: 2000, adherencePercent: 85,
      recoveryScore: 75, weightTrendKg: 0, weeksStalled: 3,
    });
    expect(result.adjustmentAmount).toBeLessThan(0);
    expect(result.newCalories).toBeLessThan(2000);
    expect(result.newCalories).toBeGreaterThanOrEqual(1850);
    expect(result.reason).toBe('progress_stalled');
  });

  it('never reduces below safety floor', () => {
    const result = computeAdjustment({
      currentCalories: 1300, adherencePercent: 90,
      recoveryScore: 80, weightTrendKg: 0, weeksStalled: 5, bmr: 1500,
    });
    expect(result.newCalories).toBeGreaterThanOrEqual(1200);
  });

  it('max adjustment is 150 calories', () => {
    const result = computeAdjustment({
      currentCalories: 2500, adherencePercent: 95,
      recoveryScore: 90, weightTrendKg: 0, weeksStalled: 10,
    });
    expect(Math.abs(result.adjustmentAmount)).toBeLessThanOrEqual(150);
  });
});

describe('Weekly Diet Generator', () => {
  it('generates 7 days of meals', () => {
    const meals = generateWeeklyMeals({
      caloriesTarget: 2200, proteinTarget: 150, carbsTarget: 250,
      fatTarget: 70, fiberTarget: 30, dislikedFoods: [], restrictions: [],
    });
    expect(meals.length).toBeGreaterThanOrEqual(21); // 3 meals × 7 days minimum
    // Every day should have breakfast, lunch, dinner
    for (let d = 0; d < 7; d++) {
      const dayMeals = meals.filter((m) => m.dayOfWeek === d);
      expect(dayMeals.some((m) => m.mealType === 'breakfast')).toBe(true);
      expect(dayMeals.some((m) => m.mealType === 'lunch')).toBe(true);
      expect(dayMeals.some((m) => m.mealType === 'dinner')).toBe(true);
    }
  });

  it('avoids disliked foods', () => {
    const meals = generateWeeklyMeals({
      caloriesTarget: 2200, proteinTarget: 150, carbsTarget: 250,
      fatTarget: 70, fiberTarget: 30, dislikedFoods: ['salmon'], restrictions: [],
    });
    const names = meals.map((m) => m.foodName.toLowerCase());
    expect(names.some((n) => n.includes('salmon'))).toBe(false);
  });

  it('rotates protein sources (no 3 consecutive same protein)', () => {
    const meals = generateWeeklyMeals({
      caloriesTarget: 2200, proteinTarget: 150, carbsTarget: 250,
      fatTarget: 70, fiberTarget: 30, dislikedFoods: [], restrictions: [],
    });
    // Check lunch+dinner: shouldn't have same protein 3 days in a row
    const mainMeals = meals.filter((m) => m.mealType === 'lunch' || m.mealType === 'dinner');
    const proteins = mainMeals.map((m) => {
      const name = m.foodName.toLowerCase();
      if (name.includes('chicken')) return 'chicken';
      if (name.includes('salmon')) return 'salmon';
      if (name.includes('beef')) return 'beef';
      return 'other';
    });
    let maxConsecutive = 1;
    let current = 1;
    for (let i = 1; i < proteins.length; i++) {
      if (proteins[i] === proteins[i - 1] && proteins[i] !== 'other') {
        current++;
        maxConsecutive = Math.max(maxConsecutive, current);
      } else {
        current = 1;
      }
    }
    expect(maxConsecutive).toBeLessThanOrEqual(3);
  });
});

describe('Shopping List Generator', () => {
  it('aggregates quantities across days', () => {
    const meals = [
      { foodName: 'Chicken', portionG: 200, calories: 330, proteinG: 60, carbsG: 0, fatG: 7, fiberG: 0 },
      { foodName: 'Chicken', portionG: 200, calories: 330, proteinG: 60, carbsG: 0, fatG: 7, fiberG: 0 },
      { foodName: 'Rice', portionG: 150, calories: 185, proteinG: 4, carbsG: 38, fatG: 2, fiberG: 1 },
    ];
    const list = generateShoppingList(meals);
    expect(list.find((i) => i.foodName === 'Chicken').quantityG).toBe(400);
    expect(list.find((i) => i.foodName === 'Rice').quantityG).toBe(150);
  });

  it('subtracts inventory from shopping list', () => {
    const meals = [
      { foodName: 'Chicken', portionG: 500, calories: 800, proteinG: 150, carbsG: 0, fatG: 17, fiberG: 0 },
    ];
    const inventory = [{ foodName: 'Chicken', quantityG: 200 }];
    const list = generateShoppingList(meals, inventory);
    expect(list.find((i) => i.foodName === 'Chicken').quantityG).toBe(300);
  });

  it('excludes items fully in inventory', () => {
    const meals = [
      { foodName: 'Rice', portionG: 200, calories: 250, proteinG: 5, carbsG: 50, fatG: 1, fiberG: 1 },
    ];
    const inventory = [{ foodName: 'Rice', quantityG: 500 }];
    const list = generateShoppingList(meals, inventory);
    expect(list.find((i) => i.foodName === 'Rice')).toBeUndefined();
  });

  it('formats quantities properly', () => {
    const meals = [
      { foodName: 'Chicken Breast', portionG: 2400, calories: 4000, proteinG: 700, carbsG: 0, fatG: 50, fiberG: 0 },
    ];
    const list = generateShoppingList(meals);
    expect(list[0].quantityDisplay).toBe('2.4kg');
  });
});

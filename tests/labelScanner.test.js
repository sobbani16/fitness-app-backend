const { adjustPortion, extractWithRegex } = require('../src/services/labelScannerService');

describe('Label Scanner Service', () => {
  describe('adjustPortion', () => {
    it('scales nutrition linearly when eating less than serving', () => {
      const label = { calories: 200, proteinG: 10, carbsG: 30, fatG: 8, fiberG: 4, sugarG: 12 };
      const result = adjustPortion(label, 200, 150); // eating 150g of a 200g serving
      expect(result.adjCalories).toBe(150);
      expect(result.adjProteinG).toBe(7.5);
      expect(result.adjCarbsG).toBe(22.5);
      expect(result.adjFatG).toBe(6);
      expect(result.adjFiberG).toBe(3);
      expect(result.adjSugarG).toBe(9);
    });

    it('scales nutrition linearly when eating more than serving', () => {
      const label = { calories: 100, proteinG: 5, carbsG: 20, fatG: 3, fiberG: 2, sugarG: 5 };
      const result = adjustPortion(label, 100, 250); // eating 2.5 servings
      expect(result.adjCalories).toBe(250);
      expect(result.adjProteinG).toBe(12.5);
      expect(result.adjCarbsG).toBe(50);
      expect(result.adjFatG).toBe(7.5);
      expect(result.adjFiberG).toBe(5);
      expect(result.adjSugarG).toBe(12.5);
    });

    it('exact same portion returns same values', () => {
      const label = { calories: 200, proteinG: 10, carbsG: 30, fatG: 8, fiberG: 4, sugarG: 12 };
      const result = adjustPortion(label, 100, 100);
      expect(result.adjCalories).toBe(200);
      expect(result.adjProteinG).toBe(10);
    });

    it('throws if servingSizeG is 0', () => {
      expect(() => adjustPortion({ calories: 100, proteinG: 5, carbsG: 20, fatG: 3 }, 0, 100)).toThrow();
    });

    it('throws if actualPortionG is 0', () => {
      expect(() => adjustPortion({ calories: 100, proteinG: 5, carbsG: 20, fatG: 3 }, 100, 0)).toThrow();
    });
  });

  describe('extractWithRegex', () => {
    it('extracts calories from typical label text', () => {
      const text = 'Serving Size 30g\nCalories 120\nTotal Fat 5g\nProtein 3g\nTotal Carbohydrate 18g\nDietary Fiber 2g\nSugars 8g\nSodium 150mg';
      const result = extractWithRegex(text);
      expect(result.servingSizeG).toBe(30);
      expect(result.calories).toBe(120);
      expect(result.fatG).toBe(5);
      expect(result.proteinG).toBe(3);
      expect(result.carbsG).toBe(18);
      expect(result.fiberG).toBe(2);
      expect(result.sugarG).toBe(8);
      expect(result.sodiumMg).toBe(150);
    });

    it('handles label with colons', () => {
      const text = 'Serving size: 50g\nCalories: 200\nProtein: 8g\nFat: 12g\nCarbohydrates: 20g\nFiber: 3g';
      const result = extractWithRegex(text);
      expect(result.servingSizeG).toBe(50);
      expect(result.calories).toBe(200);
      expect(result.proteinG).toBe(8);
      expect(result.fatG).toBe(12);
      expect(result.carbsG).toBe(20);
      expect(result.fiberG).toBe(3);
    });

    it('defaults serving size to 100g if not found', () => {
      const text = 'Calories 100\nProtein 5g';
      const result = extractWithRegex(text);
      expect(result.servingSizeG).toBe(100);
    });

    it('returns low confidence', () => {
      const text = 'Calories 100';
      const result = extractWithRegex(text);
      expect(result.confidence).toBe(0.4);
    });
  });
});

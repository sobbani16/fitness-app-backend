// pc-HUM-4 — nutrition review regression contract.
const fs = require('node:fs');
const path = require('node:path');
const fix = fs.readFileSync(path.join(__dirname, '../scripts/fix-fluid-replacement-glucose.js'), 'utf8');

describe('F-1 fix script contract', () => {
  it('dry-run default + localhost-only apply + verify-after-write + rollback SQL', () => {
    expect(fix).toMatch(/DRY RUN/);
    expect(fix).toMatch(/REFUSING non-local apply/);
    expect(fix).toMatch(/verify-after-write failed/);
    expect(fix).toMatch(/ROLLBACK/);
    expect(fix).toMatch(/\$transaction/);
  });
  it('values are label arithmetic — 5% glucose = 5g carbs, 20 kcal — never proxy data', () => {
    expect(fix).toMatch(/carbsPer100g: 5/);
    expect(fix).toMatch(/caloriesPer100g: 20/);
    expect(fix).not.toMatch(/usda|proxy|estimate/i);
  });
});
describe('catalog carbohydrate-basis finding (F-2)', () => {
  it('documented as a convention decision, not silently mutated', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../docs/nutrition-audit/HUM4-NUTRITION-REVIEW.md'), 'utf8');
    expect(doc).toMatch(/carbs-include-fiber|carbohydrate.*includes fiber/i);
    expect(doc).toMatch(/Decision needed/);
    expect(doc).toMatch(/refusing/i);
  });
});

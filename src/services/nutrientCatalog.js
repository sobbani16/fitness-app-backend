// Canonical nutrient taxonomy for Humai.
// Every supported nutrient has a stable key, canonical unit and category.
// `referenceIntake` is the adult reference value used ONLY as a display
// reference — it is not a personalised target and not a medical threshold.
// `upperLimit` is only populated where an authoritative tolerable upper
// intake level exists; null means "no established UL", not "unlimited".
const NUTRIENTS = [
  // Macronutrients — references: FDA Daily Values (food labels), fibre from
  // 14 g/1000 kcal guidance. Energy is a plan input, not a fixed reference.
  { key: 'calories', label: 'Energy', unit: 'kcal', category: 'macro', referenceIntake: null, basis: 'per-plan' },
  { key: 'proteinG', label: 'Protein', unit: 'g', category: 'macro', referenceIntake: 50, basis: 'FDA_DV' },
  { key: 'carbsG', label: 'Carbohydrate', unit: 'g', category: 'macro', referenceIntake: 275, basis: 'FDA_DV' },
  { key: 'fatG', label: 'Total fat', unit: 'g', category: 'macro', referenceIntake: 78, basis: 'FDA_DV' },
  { key: 'fiberG', label: 'Fiber', unit: 'g', category: 'macro', referenceIntake: 28, basis: 'FDA_DV' },
  { key: 'sugarG', label: 'Total sugars', unit: 'g', category: 'macro', referenceIntake: null, basis: 'no-established-target' },
  { key: 'addedSugarG', label: 'Added sugars', unit: 'g', category: 'macro', referenceIntake: 50, basis: 'FDA_DV' },
  // Fat composition
  { key: 'saturatedFatG', label: 'Saturated fat', unit: 'g', category: 'fat', referenceIntake: 20, basis: 'FDA_DV', direction: 'limit' },
  { key: 'transFatG', label: 'Trans fat', unit: 'g', category: 'fat', referenceIntake: null, basis: 'minimize', direction: 'limit' },
  { key: 'monounsaturatedFatG', label: 'Monounsaturated fat', unit: 'g', category: 'fat', referenceIntake: null, basis: 'no-established-target' },
  { key: 'polyunsaturatedFatG', label: 'Polyunsaturated fat', unit: 'g', category: 'fat', referenceIntake: null, basis: 'no-established-target' },
  { key: 'omega3G', label: 'Omega-3 (total)', unit: 'g', category: 'fat', referenceIntake: null, basis: 'no-established-target' },
  { key: 'epaMg', label: 'EPA', unit: 'mg', category: 'fat', referenceIntake: null, basis: 'no-established-target' },
  { key: 'dhaMg', label: 'DHA', unit: 'mg', category: 'fat', referenceIntake: null, basis: 'no-established-target' },
  { key: 'alaG', label: 'ALA', unit: 'g', category: 'fat', referenceIntake: 1.6, basis: 'NIH_AI_male' },
  { key: 'omega6G', label: 'Omega-6', unit: 'g', category: 'fat', referenceIntake: null, basis: 'no-established-target' },
  { key: 'cholesterolMg', label: 'Cholesterol', unit: 'mg', category: 'fat', referenceIntake: 300, basis: 'FDA_DV', direction: 'limit' },
  // Fiber subtypes
  { key: 'solubleFiberG', label: 'Soluble fiber', unit: 'g', category: 'fiber', referenceIntake: null, basis: 'no-established-target' },
  { key: 'insolubleFiberG', label: 'Insoluble fiber', unit: 'g', category: 'fiber', referenceIntake: null, basis: 'no-established-target' },
  // Minerals — FDA Daily Values; ULs only where authoritative (IOM/NASEM).
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg', category: 'mineral', referenceIntake: 2300, basis: 'FDA_DV', direction: 'limit' },
  { key: 'potassiumMg', label: 'Potassium', unit: 'mg', category: 'mineral', referenceIntake: 4700, basis: 'FDA_DV' },
  { key: 'calciumMg', label: 'Calcium', unit: 'mg', category: 'mineral', referenceIntake: 1300, basis: 'FDA_DV', upperLimit: 2500 },
  { key: 'ironMg', label: 'Iron', unit: 'mg', category: 'mineral', referenceIntake: 18, basis: 'FDA_DV', upperLimit: 45 },
  { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', category: 'mineral', referenceIntake: 420, basis: 'FDA_DV' },
  { key: 'phosphorusMg', label: 'Phosphorus', unit: 'mg', category: 'mineral', referenceIntake: 1250, basis: 'FDA_DV', upperLimit: 4000 },
  { key: 'zincMg', label: 'Zinc', unit: 'mg', category: 'mineral', referenceIntake: 11, basis: 'FDA_DV', upperLimit: 40 },
  { key: 'seleniumMcg', label: 'Selenium', unit: 'mcg', category: 'mineral', referenceIntake: 55, basis: 'FDA_DV', upperLimit: 400 },
  { key: 'iodineMcg', label: 'Iodine', unit: 'mcg', category: 'mineral', referenceIntake: 150, basis: 'FDA_DV', upperLimit: 1100 },
  { key: 'copperMg', label: 'Copper', unit: 'mg', category: 'mineral', referenceIntake: 0.9, basis: 'FDA_DV', upperLimit: 10 },
  { key: 'manganeseMg', label: 'Manganese', unit: 'mg', category: 'mineral', referenceIntake: 2.3, basis: 'FDA_DV', upperLimit: 11 },
  { key: 'chromiumMcg', label: 'Chromium', unit: 'mcg', category: 'mineral', referenceIntake: 35, basis: 'FDA_DV' },
  { key: 'molybdenumMcg', label: 'Molybdenum', unit: 'mcg', category: 'mineral', referenceIntake: 45, basis: 'FDA_DV', upperLimit: 2000 },
  { key: 'chlorideMg', label: 'Chloride', unit: 'mg', category: 'mineral', referenceIntake: 2300, basis: 'FDA_DV' },
  // Vitamins
  { key: 'vitaminAMcg', label: 'Vitamin A (RAE)', unit: 'mcg', category: 'vitamin', referenceIntake: 900, basis: 'FDA_DV', upperLimit: 3000 },
  { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', category: 'vitamin', referenceIntake: 90, basis: 'FDA_DV', upperLimit: 2000 },
  { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', category: 'vitamin', referenceIntake: 20, basis: 'FDA_DV', upperLimit: 100 },
  { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg', category: 'vitamin', referenceIntake: 15, basis: 'FDA_DV', upperLimit: 1000 },
  { key: 'vitaminKMcg', label: 'Vitamin K', unit: 'mcg', category: 'vitamin', referenceIntake: 120, basis: 'FDA_DV' },
  { key: 'thiaminMg', label: 'Thiamin (B1)', unit: 'mg', category: 'vitamin', referenceIntake: 1.2, basis: 'FDA_DV' },
  { key: 'riboflavinMg', label: 'Riboflavin (B2)', unit: 'mg', category: 'vitamin', referenceIntake: 1.3, basis: 'FDA_DV' },
  { key: 'niacinMg', label: 'Niacin (B3)', unit: 'mg', category: 'vitamin', referenceIntake: 16, basis: 'FDA_DV', upperLimit: 35 },
  { key: 'pantothenicAcidMg', label: 'Pantothenic acid (B5)', unit: 'mg', category: 'vitamin', referenceIntake: 5, basis: 'FDA_DV' },
  { key: 'vitaminB6Mg', label: 'Vitamin B6', unit: 'mg', category: 'vitamin', referenceIntake: 1.7, basis: 'FDA_DV', upperLimit: 100 },
  { key: 'biotinMcg', label: 'Biotin (B7)', unit: 'mcg', category: 'vitamin', referenceIntake: 30, basis: 'FDA_DV' },
  { key: 'folateMcg', label: 'Folate (B9, DFE)', unit: 'mcg', category: 'vitamin', referenceIntake: 400, basis: 'FDA_DV', upperLimit: 1000 },
  { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', category: 'vitamin', referenceIntake: 2.4, basis: 'FDA_DV' },
  // Additional components
  { key: 'cholineMg', label: 'Choline', unit: 'mg', category: 'other', referenceIntake: 550, basis: 'FDA_DV' },
  { key: 'caffeineMg', label: 'Caffeine', unit: 'mg', category: 'other', referenceIntake: null, basis: 'no-established-target', direction: 'monitor' },
];
const BY_KEY = Object.fromEntries(NUTRIENTS.map(n => [n.key, n]));
// Nutrients the current FoodLog table always stores explicitly.
const FOODLOG_NATIVE = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'];
// Extra numeric nutrients we accept from a FoodLog.nutritionSnapshot payload.
const SNAPSHOT_NUTRIENTS = ['sugarG', 'addedSugarG', 'saturatedFatG', 'transFatG', 'sodiumMg'];
module.exports = { NUTRIENTS, BY_KEY, FOODLOG_NATIVE, SNAPSHOT_NUTRIENTS };

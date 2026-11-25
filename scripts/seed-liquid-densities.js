#!/usr/bin/env node
// Seeds Ingredient.densityGPerMl for catalog liquids so the density-guarded
// volume path (POST /food-logs {volumeMl}) works for them.
// Values are reference g/ml at ~20°C from standard tables; an ingredient only
// gets a density when its name EXACTLY matches a curated entry — matching a
// powder/solid by substring would fabricate mass, which is worse than none.
// Dry-run by default; --apply writes.
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');

// name (lowercased, whitespace-normalized) → [g/ml, basis note]
const DENSITIES = {
  'water plain': [1.0, 'water'],
  'kewra water': [1.0, 'flavored water'],
  'rose water': [1.0, 'flavored water'],
  'coconut water': [1.0, 'USDA ~1.00'],
  'whole buffalo milk': [1.04, 'buffalo milk richer than cow'],
  'whole cow milk': [1.03, 'whole milk ~1.030'],
  'skim milk': [1.033, 'skim milk ~1.033'],
  'toned milk': [1.032, 'toned milk ~1.032'],
  'double-toned milk': [1.033, 'double-toned ~1.033'],
  'buttermilk (chaas)': [1.03, 'cultured buttermilk ~1.03'],
  'sweet lassi': [1.04, 'yogurt drink + sugar ~1.04'],
  'plain lassi': [1.03, 'yogurt drink ~1.03'],
  'cream heavy': [1.01, 'heavy cream ~1.005-1.012'],
  'condensed milk sweetened': [1.3, 'sweetened condensed ~1.30'],
  'evaporated milk': [1.07, 'evaporated milk ~1.066'],
  'almond milk unsweetened': [1.02, 'unsweetened almond beverage ~1.02'],
  'soy milk unsweetened': [1.03, 'unsweetened soy beverage ~1.03'],
  'oat milk unsweetened': [1.02, 'unsweetened oat beverage ~1.02'],
  'coconut milk canned': [0.98, 'canned coconut milk ~0.98'],
  'coconut cream': [0.97, 'coconut cream ~0.97'],
  'lemon juice raw': [1.03, 'citrus juice ~1.03'],
  'sugarcane juice': [1.06, 'sugarcane juice ~1.05-1.08'],
  'groundnut oil': [0.91, 'peanut oil ~0.91'], 'groundnut oil pure': [0.91, 'peanut oil ~0.91'],
  'sunflower oil': [0.92, 'sunflower oil ~0.92'], 'sunflower oil pure': [0.92, 'sunflower oil ~0.92'],
  'mustard oil': [0.91, 'mustard oil ~0.91'], 'mustard oil pure': [0.91, 'mustard oil ~0.91'],
  'sesame oil': [0.92, 'sesame oil ~0.92'], 'sesame oil pure': [0.92, 'sesame oil ~0.92'],
  'gingelly oil': [0.92, 'gingelly = sesame ~0.92'],
  'coconut oil': [0.92, 'coconut oil ~0.92'], 'coconut oil pure': [0.92, 'coconut oil ~0.92'],
  'olive oil': [0.91, 'olive oil ~0.91'], 'olive oil extra virgin': [0.91, 'olive oil ~0.91'],
  'olive oil pure': [0.91, 'olive oil ~0.91'],
  'canola oil': [0.92, 'canola oil ~0.92'], 'canola oil pure': [0.92, 'canola oil ~0.92'],
  'rice bran oil': [0.92, 'rice bran oil ~0.92'], 'rice bran oil pure': [0.92, 'rice bran oil ~0.92'],
  'soybean oil': [0.92, 'soybean oil ~0.92'], 'soybean oil pure': [0.92, 'soybean oil ~0.92'],
  'palm oil': [0.9, 'palm oil ~0.90'], 'palm oil pure': [0.9, 'palm oil ~0.90'],
  'avocado oil': [0.92, 'avocado oil ~0.92'], 'avocado oil pure': [0.92, 'avocado oil ~0.92'],
  'grapeseed oil': [0.92, 'grapeseed oil ~0.92'], 'grapeseed oil pure': [0.92, 'grapeseed oil ~0.92'],
  'safflower oil': [0.92, 'safflower oil ~0.92'],
  // USDA-style catalog names (comma-inverted) and pourable condiments —
  // sauces are legitimately logged by volume (tbsp/ml), so they need density
  // just as much as drinks do. Excluded on purpose: powders (milk powder),
  // solids (cream cheese, mozzarella, coconut flesh), dishes (curry, soup).
  'milk, whole': [1.03, 'whole milk ~1.030'],
  'milk, low-fat': [1.033, 'low-fat milk ~1.033'],
  'rice milk': [1.02, 'rice beverage ~1.02'],
  'vegetable cooking oil': [0.92, 'blended veg oil ~0.92'],
  'lemon juice': [1.03, 'citrus juice ~1.03'],
  'lime juice': [1.03, 'citrus juice ~1.03'],
  'honey': [1.42, 'honey ~1.42'],
  'water': [1.0, 'water'],
  'balsamic vinegar': [1.1, 'balsamic ~1.10'],
  'rice vinegar': [1.01, 'rice vinegar ~1.01'],
  'white vinegar': [1.01, 'distilled vinegar ~1.01'],
  'chicken broth': [1.0, 'broth ~1.00'],
  'vegetable broth': [1.0, 'broth ~1.00'],
  'coconut milk, canned': [0.98, 'canned coconut milk ~0.98'],
  'fish sauce': [1.15, 'fish sauce ~1.15'],
  'soy sauce': [1.16, 'soy sauce ~1.16'],
  'oyster sauce': [1.09, 'oyster sauce ~1.09'],
  'hoisin sauce': [1.1, 'hoisin ~1.10'],
  'maple syrup': [1.32, 'maple syrup ~1.32'],
  'heavy cream': [1.01, 'heavy cream ~1.005-1.012'],
  'sour cream': [1.0, 'sour cream ~1.00'],
  'taco sauce': [1.05, 'thin sauce ~1.05'],
  'curry sauce': [1.05, 'simmer sauce ~1.05'],
  'hot thai sauce': [1.05, 'thin sauce ~1.05'],
  'enchilada sauce': [1.04, 'enchilada sauce ~1.04'],
  'marinara sauce': [1.05, 'marinara ~1.05'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = getPrisma();
  const ingredients = await prisma.ingredient.findMany({ select: { id: true, name: true, normalizedName: true, densityGPerMl: true, sourceMetadata: true } });
  const report = { applied: [], already: [], notFound: [], conflicts: [] };
  const found = new Set();
  for (const ing of ingredients) {
    const key = norm(ing.normalizedName || ing.name);
    const spec = DENSITIES[key];
    if (!spec) continue;
    found.add(key);
    const [density, basis] = spec;
    if (ing.densityGPerMl != null && Math.abs(ing.densityGPerMl - density) < 0.001) { report.already.push(ing.name); continue; }
    if (ing.densityGPerMl != null) report.conflicts.push({ name: ing.name, existing: ing.densityGPerMl, curated: density });
    if (apply) {
      await prisma.ingredient.update({
        where: { id: ing.id },
        data: {
          densityGPerMl: density,
          sourceMetadata: { ...(ing.sourceMetadata || {}), densityGPerMlSource: `reference table, ${basis} — seeded by seed-liquid-densities.js` },
        },
      });
    }
    report.applied.push({ name: ing.name, density, basis });
  }
  report.notFound = Object.keys(DENSITIES).filter(k => !found.has(k));
  console.log(JSON.stringify({ apply, counts: { applied: report.applied.length, already: report.already.length, notFound: report.notFound.length, conflicts: report.conflicts.length }, report }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });

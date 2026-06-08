// Seeds dummy/test data into the database for API testing.
// Run with:  node prisma/seed-dummy.js

const { getPrisma } = require('../src/lib/prisma');

async function main() {
  const prisma = getPrisma();

  // ---- Ingredients (pre-cache some common ones) ----
  const ingredients = [
    { fdcId: 'dummy-1', name: 'Chicken breast, raw', normalizedName: 'chicken breast, raw', caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, source: 'seed' },
    { fdcId: 'dummy-2', name: 'Brown rice, cooked', normalizedName: 'brown rice, cooked', caloriesPer100g: 123, proteinPer100g: 2.7, carbsPer100g: 25.6, fatPer100g: 1, source: 'seed' },
    { fdcId: 'dummy-3', name: 'Broccoli, raw', normalizedName: 'broccoli, raw', caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 7, fatPer100g: 0.4, source: 'seed' },
    { fdcId: 'dummy-4', name: 'Banana', normalizedName: 'banana', caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3, source: 'seed' },
    { fdcId: 'dummy-5', name: 'Eggs, whole, raw', normalizedName: 'eggs, whole, raw', caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11, source: 'seed' },
    { fdcId: 'dummy-6', name: 'Salmon, Atlantic, raw', normalizedName: 'salmon, atlantic, raw', caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, source: 'seed' },
    { fdcId: 'dummy-7', name: 'Sweet potato, baked', normalizedName: 'sweet potato, baked', caloriesPer100g: 90, proteinPer100g: 2, carbsPer100g: 21, fatPer100g: 0.1, source: 'seed' },
    { fdcId: 'dummy-8', name: 'Greek yogurt, plain', normalizedName: 'greek yogurt, plain', caloriesPer100g: 59, proteinPer100g: 10, carbsPer100g: 3.6, fatPer100g: 0.7, source: 'seed' },
    { fdcId: 'dummy-9', name: 'Oats, rolled, dry', normalizedName: 'oats, rolled, dry', caloriesPer100g: 389, proteinPer100g: 17, carbsPer100g: 66, fatPer100g: 7, source: 'seed' },
    { fdcId: 'dummy-10', name: 'Almonds, raw', normalizedName: 'almonds, raw', caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50, source: 'seed' },
    { fdcId: 'dummy-11', name: 'Avocado', normalizedName: 'avocado', caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 8.5, fatPer100g: 15, source: 'seed' },
    { fdcId: 'dummy-12', name: 'Chickpeas, cooked', normalizedName: 'chickpeas, cooked', caloriesPer100g: 164, proteinPer100g: 8.9, carbsPer100g: 27, fatPer100g: 2.6, source: 'seed' },
    { fdcId: 'dummy-13', name: 'Quinoa, cooked', normalizedName: 'quinoa, cooked', caloriesPer100g: 120, proteinPer100g: 4.4, carbsPer100g: 21, fatPer100g: 1.9, source: 'seed' },
    { fdcId: 'dummy-14', name: 'Spinach, raw', normalizedName: 'spinach, raw', caloriesPer100g: 23, proteinPer100g: 2.9, carbsPer100g: 3.6, fatPer100g: 0.4, source: 'seed' },
    { fdcId: 'dummy-15', name: 'Whey protein powder', normalizedName: 'whey protein powder', caloriesPer100g: 400, proteinPer100g: 80, carbsPer100g: 10, fatPer100g: 5, source: 'seed' },
  ];

  for (const ing of ingredients) {
    await prisma.ingredient.upsert({
      where: { fdcId: ing.fdcId },
      update: ing,
      create: ing,
    });
  }
  console.log(`Seeded ${ingredients.length} ingredients.`);

  // ---- Link some ingredients to a test user ----
  const testUserId = 'test-user-1';
  const allIngredients = await prisma.ingredient.findMany({ take: 5 });
  for (const ing of allIngredients) {
    await prisma.userIngredient.upsert({
      where: { userId_ingredientId: { userId: testUserId, ingredientId: ing.id } },
      update: { searchCount: { increment: 1 }, lastSearchedAt: new Date() },
      create: { userId: testUserId, ingredientId: ing.id },
    });
  }
  console.log(`Linked ${allIngredients.length} ingredients to user '${testUserId}'.`);

  console.log('\nDummy data seeded successfully!');
  console.log('Test user ID: test-user-1');
}

main()
  .then(async () => {
    await getPrisma().$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await getPrisma().$disconnect();
    process.exit(1);
  });

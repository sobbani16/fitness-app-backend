// Proactive Daily Coaching Service
// Generates context-aware messages at different times of day.

const { getPrisma } = require('../../lib/prisma');
const { buildUserContext } = require('./contextBuilder');

/**
 * Generate proactive coaching messages for a user based on current context.
 * @param {string} userId
 * @param {object} [opts]
 * @param {number} [opts.dailyCaloriesTarget]
 * @param {number} [opts.dailyProteinTarget]
 * @param {number} [opts.dailyWaterTarget]
 * @returns {Promise<Array<{timeSlot: string, message: string, category: string}>>}
 */
async function generateCoachingMessages(userId, opts = {}) {
  const context = await buildUserContext(userId);
  const messages = [];

  const dailyCalories = opts.dailyCaloriesTarget || 2200;
  const dailyProtein = opts.dailyProteinTarget || 150;
  const dailyWater = opts.dailyWaterTarget || 2000;

  const caloriesRemaining = dailyCalories - context.today.calories;
  const proteinRemaining = dailyProtein - context.today.proteinG;
  const waterRemaining = dailyWater - context.today.waterMl;

  // Morning messages.
  if (context.timeOfDay === 'morning') {
    messages.push({
      timeSlot: 'morning',
      message: `Good morning! Your protein target today is ${dailyProtein}g. Let's hit it.`,
      category: 'protein',
    });
    if (context.recovery.score < 60) {
      messages.push({
        timeSlot: 'morning',
        message: `Recovery score is ${context.recovery.score}/100. Consider a lighter workout today.`,
        category: 'recovery',
      });
    }
  }

  // Afternoon messages.
  if (context.timeOfDay === 'afternoon') {
    if (waterRemaining > 1000) {
      messages.push({
        timeSlot: 'afternoon',
        message: `You are behind on water intake. Drink at least ${Math.round(waterRemaining / 250)} more glasses today.`,
        category: 'hydration',
      });
    }
    if (context.today.mealCount < 2) {
      messages.push({
        timeSlot: 'afternoon',
        message: `Only ${context.today.mealCount} meal logged so far. Don't skip lunch!`,
        category: 'calories',
      });
    }
  }

  // Evening messages.
  if (context.timeOfDay === 'evening') {
    if (caloriesRemaining > 400) {
      messages.push({
        timeSlot: 'evening',
        message: `You have ${caloriesRemaining} calories remaining. Time for a balanced dinner.`,
        category: 'calories',
      });
    } else if (caloriesRemaining < 100) {
      messages.push({
        timeSlot: 'evening',
        message: `You've nearly hit your calorie target. Choose a light dinner or skip heavy carbs.`,
        category: 'calories',
      });
    }
  }

  // Night messages.
  if (context.timeOfDay === 'night') {
    if (proteinRemaining > 30) {
      messages.push({
        timeSlot: 'night',
        message: `You are ${Math.round(proteinRemaining)}g short of your protein target. Consider a protein shake before bed.`,
        category: 'protein',
      });
    }
    if (context.today.calories > dailyCalories * 1.2) {
      messages.push({
        timeSlot: 'night',
        message: `You went over your calorie target today by ${Math.round(context.today.calories - dailyCalories)} kcal. No worries — adjust tomorrow.`,
        category: 'calories',
      });
    }
  }

  // Supplement reminders (any time).
  if (context.supplements.length > 0 && context.timeOfDay !== 'night') {
    messages.push({
      timeSlot: context.timeOfDay,
      message: `Don't forget your supplements today: ${context.supplements.map((s) => s.name).slice(0, 3).join(', ')}.`,
      category: 'supplement',
    });
  }

  return messages;
}

/**
 * Store coaching messages in the database and return them.
 */
async function generateAndStoreCoaching(userId, opts = {}) {
  const prisma = getPrisma();
  const messages = await generateCoachingMessages(userId, opts);

  if (messages.length > 0) {
    await prisma.dailyCoachingMessage.createMany({
      data: messages.map((m) => ({ userId, ...m })),
    });
  }

  return messages;
}

module.exports = { generateCoachingMessages, generateAndStoreCoaching };

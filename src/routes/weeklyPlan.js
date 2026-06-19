const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { generateWeeklyPlan } = require('../services/weekly/weeklyDietGenerator');
const { calculateAdherence } = require('../services/weekly/adherenceEngine');
const { adjustCalories } = require('../services/weekly/calorieAdjustmentEngine');
const { generateWeeklyReview } = require('../services/weekly/weeklyReviewGenerator');
const { detectDeficiencies } = require('../services/weekly/deficiencyDetector');
const { getAlternatives, swapMeal } = require('../services/weekly/mealSwapService');
const { confirmDay, unconfirmDayByTrainer, canEditDay, allDaysConfirmed } = require('../services/weekly/confirmationService');
const { generateIngredientShoppingList, toggleChecked, getShoppingList } = require('../services/weekly/ingredientShoppingListService');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// POST /weekly-plan/generate — generate a new weekly plan
router.post('/generate', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { weekStartDate, caloriesTarget, proteinTarget, carbsTarget, fatTarget, fiberTarget } = req.body || {};
    if (!weekStartDate) return res.status(400).json({ error: 'weekStartDate required (YYYY-MM-DD)' });
    const result = await generateWeeklyPlan(userId, weekStartDate, {
      caloriesTarget: caloriesTarget || 2200,
      proteinTarget: proteinTarget || 150,
      carbsTarget: carbsTarget || 250,
      fatTarget: fatTarget || 70,
      fiberTarget: fiberTarget || 30,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /weekly-plan/current — get the current week's plan
router.get('/current', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    const plan = await prisma.weeklyNutritionPlan.findFirst({
      where: { userId, status: 'active' },
      include: {
        meals: { orderBy: [{ dayOfWeek: 'asc' }, { mealType: 'asc' }], include: { recipe: { include: { ingredients: true } } } },
        shoppingList: { include: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) return res.status(404).json({ error: 'No active plan found.' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /weekly-plan/:weekStartDate — get plan for a specific week
router.get('/:weekStartDate', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    const plan = await prisma.weeklyNutritionPlan.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate: req.params.weekStartDate } },
      include: {
        meals: { orderBy: [{ dayOfWeek: 'asc' }, { mealType: 'asc' }], include: { recipe: { include: { ingredients: true } } } },
        shoppingList: { include: { items: true } },
        review: { include: { recommendations: true } },
      },
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /weekly-plan/adherence/:weekStartDate — adherence score
router.get('/adherence/:weekStartDate', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const result = await calculateAdherence(userId, req.params.weekStartDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /weekly-plan/adjust-calories — run the adaptive calorie engine
router.post('/adjust-calories', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { weekStartDate, currentCalories, adherencePercent, recoveryScore, weightTrendKg, weeksStalled } = req.body || {};
    if (!weekStartDate || !currentCalories) return res.status(400).json({ error: 'weekStartDate and currentCalories required' });
    const result = await adjustCalories(userId, weekStartDate, {
      currentCalories, adherencePercent: adherencePercent || 0,
      recoveryScore: recoveryScore || 70, weightTrendKg: weightTrendKg || 0, weeksStalled: weeksStalled || 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /weekly-plan/review/:weekStartDate — generate weekly review
router.post('/review/:weekStartDate', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    const plan = await prisma.weeklyNutritionPlan.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate: req.params.weekStartDate } },
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const result = await generateWeeklyReview(userId, plan.id, req.params.weekStartDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /weekly-plan/deficiencies — detect nutritional deficiencies
router.get('/deficiencies/detect', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const days = req.query.days ? Number(req.query.days) : 14;
    const recommendations = await detectDeficiencies(userId, days);
    res.json({ recommendations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === INVENTORY ===

// GET /weekly-plan/inventory — user's food inventory
router.get('/inventory/list', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    const items = await prisma.foodInventory.findMany({ where: { userId }, orderBy: { foodName: 'asc' } });
    res.json({ inventory: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /weekly-plan/inventory — add/update inventory item
router.post('/inventory', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { foodName, quantityG, expirationDate } = req.body || {};
    if (!foodName) return res.status(400).json({ error: 'foodName required' });
    const prisma = getPrisma();
    const item = await prisma.foodInventory.upsert({
      where: { userId_foodName: { userId, foodName } },
      update: { quantityG: quantityG || 0, expirationDate: expirationDate ? new Date(expirationDate) : null },
      create: { userId, foodName, quantityG: quantityG || 0, expirationDate: expirationDate ? new Date(expirationDate) : null },
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === PREFERENCES ===

// GET /weekly-plan/preferences
router.get('/preferences/me', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    let prefs = await prisma.userPlanningPreferences.findUnique({ where: { userId } });
    if (!prefs) prefs = await prisma.userPlanningPreferences.create({ data: { userId } });
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /weekly-plan/preferences
router.put('/preferences', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    const prefs = await prisma.userPlanningPreferences.upsert({
      where: { userId },
      update: req.body || {},
      create: { userId, ...req.body },
    });
    res.json(prefs);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === NOTIFICATIONS ===

// GET /weekly-plan/notifications
router.get('/notifications/me', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const prisma = getPrisma();
    const notifs = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ notifications: notifs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === MEAL CUSTOMIZATION ===

// GET /weekly-plan/meals/:mealId/alternatives
router.get('/meals/:mealId/alternatives', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const alternatives = await getAlternatives(req.params.mealId);
    res.json({ alternatives });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /weekly-plan/meals/:mealId/swap
router.post('/meals/:mealId/swap', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { recipeId } = req.body || {};
    if (!recipeId) return res.status(400).json({ error: 'recipeId required' });
    const meal = await swapMeal(req.params.mealId, recipeId);
    res.json({ meal });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /weekly-plan/days/:dayOfWeek/confirm
router.post('/days/:dayOfWeek/confirm', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId required' });
    const state = await confirmDay(planId, Number(req.params.dayOfWeek), userId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /weekly-plan/days/:dayOfWeek/unconfirm
router.post('/days/:dayOfWeek/unconfirm', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId required' });
    const state = await unconfirmDayByTrainer(planId, Number(req.params.dayOfWeek), userId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /weekly-plan/days/:dayOfWeek/edit-state?planId=
router.get('/days/:dayOfWeek/edit-state', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { planId } = req.query || {};
    if (!planId) return res.status(400).json({ error: 'planId required' });
    const state = await canEditDay(planId, Number(req.params.dayOfWeek), userId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === SHOPPING LIST ===

// POST /weekly-plan/shopping-list/generate
router.post('/shopping-list/generate', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId required' });
    const result = await generateIngredientShoppingList(planId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /weekly-plan/shopping-list?planId=
router.get('/shopping-list', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { planId } = req.query || {};
    if (!planId) return res.status(400).json({ error: 'planId required' });
    const list = await getShoppingList(planId);
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /weekly-plan/shopping-list/items/:itemId/check
router.patch('/shopping-list/items/:itemId/check', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const { checked } = req.body || {};
    const item = await toggleChecked(req.params.itemId, checked);
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

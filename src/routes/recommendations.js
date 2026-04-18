const express = require('express');
const {
  calculateBMR,
  calculateTDEE,
  computeDailyBalance,
} = require('../services/calorieEngine');
const { recommendFromBalance } = require('../services/recommendationEngine');

const router = express.Router();

// GET /recommendations
// Query params (all optional, with demo defaults so the mobile Dashboard can
// hit this without a profile yet):
//   sex=male|female|other   weightKg, heightCm, age
//   activityLevel=sedentary|light|moderate|active|very_active
//   goal=lose|maintain|gain
//   caloriesIn, caloriesBurnedExercise
//   weather=hot|rainy|pleasant
router.get('/', (req, res) => {
  try {
    const q = req.query;
    const profile = {
      sex: q.sex || 'male',
      weightKg: num(q.weightKg, 75),
      heightCm: num(q.heightCm, 175),
      age: num(q.age, 30),
    };
    const activityLevel = q.activityLevel || 'sedentary';
    const goal = q.goal || 'maintain';
    const caloriesIn = num(q.caloriesIn, 2200);
    const caloriesBurnedExercise = num(q.caloriesBurnedExercise, 0);
    const weather = q.weather ? { condition: q.weather } : undefined;

    const bmr = calculateBMR(profile);
    const tdee = calculateTDEE(bmr, activityLevel);
    const balance = computeDailyBalance({ caloriesIn, caloriesBurnedExercise, tdee, goal });
    const recommendation = recommendFromBalance(balance, { weather });

    res.json({ profile, activityLevel, goal, bmr: Math.round(bmr), balance, recommendation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function num(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = router;

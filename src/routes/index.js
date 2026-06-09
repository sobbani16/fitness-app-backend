const express = require('express');
const health = require('./health');
const meals = require('./meals');
const recommendations = require('./recommendations');
const summary = require('./summary');
const chat = require('./chat');
const weather = require('./weather');
const exercises = require('./exercises');
const recipes = require('./recipes');
const supplements = require('./supplements');
const ingredients = require('./ingredients');
const safety = require('./safety');

const router = express.Router();

router.use('/health', health);
router.use('/meals', meals);
router.use('/recommendations', recommendations);
router.use('/summary', summary);
router.use('/chat', chat);
router.use('/weather', weather);
router.use('/exercises', exercises);
router.use('/recipes', recipes);
router.use('/supplements', supplements);
router.use('/ingredients', ingredients);
router.use('/safety', safety);

module.exports = router;

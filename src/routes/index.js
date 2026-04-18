const express = require('express');
const health = require('./health');
const meals = require('./meals');
const recommendations = require('./recommendations');
const summary = require('./summary');
const chat = require('./chat');
const weather = require('./weather');

const router = express.Router();

router.use('/health', health);
router.use('/meals', meals);
router.use('/recommendations', recommendations);
router.use('/summary', summary);
router.use('/chat', chat);
router.use('/weather', weather);

module.exports = router;

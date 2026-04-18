const express = require('express');
const { fetchWeather } = require('../services/weatherService');

const router = express.Router();

// GET /weather?lat=&lon=
router.get('/', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const data = await fetchWeather(lat, lon);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

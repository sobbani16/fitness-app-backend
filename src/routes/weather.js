const express = require('express');
const { fetchWeather, geocodeCity } = require('../services/weatherService');
const { fetchEnvironment, markStale } = require('../services/environmentService');
const { requireFeature } = require('../middleware/requireFeature');

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

// GET /weather/environment?lat=&lon= — normalized observation consumed by the
// activity safety engine (v2). Missing measurements stay null/flagged.
router.get('/environment', requireFeature('weather_intelligence_v2'), async (req, res) => {
  try {
    res.json(markStale(await fetchEnvironment(req.query.lat, req.query.lon)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /weather/geocode?q= — resolve a manual city name to coordinates.
router.get('/geocode', async (req, res) => {
  try {
    res.json({ results: await geocodeCity(req.query.q) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

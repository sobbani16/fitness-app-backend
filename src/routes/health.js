const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

router.get('/ready', async (req,res) => {
  try { await require('../lib/prisma').getPrisma().$queryRaw`SELECT 1`; res.json({status:'ready'}); }
  catch { res.status(503).json({status:'unavailable'}); }
});
module.exports = router;

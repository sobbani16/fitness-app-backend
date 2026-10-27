const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

router.get('/ready', async (req,res) => {
  try {
    const prisma = require('../lib/prisma').getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    if (process.env.NODE_ENV === 'production') await require('../services/deploymentReadiness').assertDeploymentReady(prisma);
    res.json({status:'ready'});
  }
  catch { res.status(503).json({status:'unavailable'}); }
});
module.exports = router;

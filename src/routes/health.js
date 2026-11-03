const express = require('express');
const { versionInfo } = require('../config/version');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Public, non-secret build identity so clients and operators can confirm
// exactly which revision is serving traffic.
router.get('/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(versionInfo());
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

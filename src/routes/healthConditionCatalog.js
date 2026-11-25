// GET /health-conditions — public supported-condition catalog (search/browse).
// Read-only; enriched from the versioned registry. User writes live at
// /me/health-conditions.
const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { requireFeature } = require('../middleware/requireFeature');
const R = require('../services/healthOutcomes/conditionRegistry');

router.use(requireFeature('health_conditions'));

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query?.q || '').toLowerCase().trim();
    let list = await R.catalog(getPrisma());
    if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || (R.REGISTRY[c.slug]?.aliases || []).some(a => a.includes(q)));
    res.json({ catalog: list });
  } catch (e) { next(e); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const meta = R.REGISTRY[req.params.slug];
    if (!meta) return res.status(404).json({ error: 'not_found' });
    res.json({ slug: req.params.slug, name: meta.name, category: meta.category, evidenceClass: meta.evidenceClass, education: meta.education });
  } catch (e) { next(e); }
});

module.exports = router;

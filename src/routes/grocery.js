const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { normalize } = require('../services/ingredientCsv');

const uid = (req) => (req.userId || req.headers['x-user-id'] || '').toString().trim();
const requireUser = (req) => { const u = uid(req); if (!u) throw httpError(401, 'Sign in required.'); return u; };

// GET /grocery?status=pending|purchased|skipped|all
router.get('/', async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const status = req.query.status || 'pending';
    const where = { userId };
    if (status !== 'all') where.status = status;
    const items = await getPrisma().groceryItem.findMany({ where, orderBy: { createdAt: 'asc' } });
    res.json({ items });
  } catch (e) { next(e); }
});

// POST /grocery { items: [{name, amountG?, unitLabel?, optional?, sourceRecipeId?}] }
// Merges with pending rows of the same normalized name (quantities combine).
router.post('/', async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : (req.body?.name ? [req.body] : []);
    if (!items.length || items.length > 100) throw httpError(400, 'items must be 1–100 entries.');
    const prisma = getPrisma();
    const out = new Map(); // dedupe: multiple inputs may merge into one row
    for (const it of items) {
      const name = String(it.name || '').trim().slice(0, 200);
      if (!name) continue;
      const normalizedName = normalize(name);
      const amountG = Number.isFinite(Number(it.amountG)) ? Math.max(0, Number(it.amountG)) : null;
      const existing = await prisma.groceryItem.findFirst({ where: { userId, normalizedName, status: 'pending' } });
      if (existing) {
        const updated = await prisma.groceryItem.update({
          where: { id: existing.id },
          data: {
            amountG: existing.amountG != null && amountG != null ? existing.amountG + amountG : (amountG ?? existing.amountG),
            sourceRecipeId: existing.sourceRecipeId || it.sourceRecipeId || null,
          },
        });
        out.set(updated.id, updated);
      } else {
        const created = await prisma.groceryItem.create({
          data: {
            userId, name, normalizedName, amountG,
            unitLabel: it.unitLabel ? String(it.unitLabel).slice(0, 40) : null,
            optional: it.optional === true,
            sourceRecipeId: it.sourceRecipeId ? String(it.sourceRecipeId) : null,
          },
        });
        out.set(created.id, created);
      }
    }
    res.status(201).json({ items: [...out.values()] });
  } catch (e) { next(e); }
});

// PATCH /grocery/:id {status?, amountG?, name?}
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const item = await getPrisma().groceryItem.findFirst({ where: { id: req.params.id, userId } });
    if (!item) throw httpError(404, 'Item not found.');
    const b = req.body || {};
    if (b.status != null && !['pending', 'purchased', 'skipped'].includes(b.status)) throw httpError(400, 'status must be pending|purchased|skipped');
    const updated = await getPrisma().groceryItem.update({
      where: { id: item.id },
      data: {
        ...(b.status != null ? { status: b.status } : {}),
        ...(b.amountG != null ? { amountG: Math.max(0, Number(b.amountG) || 0) } : {}),
        ...(b.name != null ? { name: String(b.name).slice(0, 200), normalizedName: normalize(b.name) } : {}),
      },
    });
    res.json({ item: updated });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const item = await getPrisma().groceryItem.findFirst({ where: { id: req.params.id, userId } });
    if (!item) throw httpError(404, 'Item not found.');
    await getPrisma().groceryItem.delete({ where: { id: item.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

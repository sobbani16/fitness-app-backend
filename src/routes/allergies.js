// /me/allergies — the user's own food-allergy list (HF-0001).
// Identity comes only from the authenticated session (req.userId); there is no
// way to read or write another user's allergies through this router.
// Saving re-validates the active weekly plan immediately; all other surfaces
// (meal suggestions, recommendations, suitability checks) read allergies on
// every request, so no cached recommendation can outlive a change.
const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const A = require('../services/allergens');
const { revalidateActivePlans } = require('../services/allergyRevalidation');

const DISCLAIMER = 'Allergy filters match ingredient names and declared allergens. They cannot detect cross-contact or undeclared ingredients — always check labels and ask how food is prepared.';
const view = (list) => ({
  allergens: list.keys.map(k => ({ key: k, label: A.ALLERGENS[k].label })),
  custom: list.custom,
  options: A.KEYS.map(k => ({ key: k, label: A.ALLERGENS[k].label })),
  disclaimer: DISCLAIMER,
});

router.get('/', async (req, res, next) => {
  try { res.json(view(await A.loadUserAllergies(getPrisma(), req.userId))); } catch (e) { next(e); }
});

// PUT /me/allergies { allergens: string[] (canonical keys), custom?: string[] } — replaces the set.
router.put('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!Array.isArray(b.allergens) || (b.custom != null && !Array.isArray(b.custom))) throw httpError(400, 'Send { allergens: [...keys], custom: [...names] }.');
    if (b.allergens.length > A.KEYS.length) throw httpError(400, 'Too many allergens.');
    const bad = b.allergens.filter(k => typeof k !== 'string' || !A.KEYS.includes(k));
    if (bad.length) throw httpError(400, `Unknown allergen key(s): ${bad.slice(0, 5).join(', ')}`);
    const rawCustom = b.custom || [];
    if (rawCustom.length > 10) throw httpError(400, 'Up to 10 other allergens.');
    // Validate the RAW input (letters, spaces, apostrophes, hyphens) before normalizing.
    if (rawCustom.some(c => typeof c !== 'string' || !/^\p{L}[\p{L} '\-]{1,39}$/u.test(c.trim()))) throw httpError(400, 'Other allergens must be 2–40 letters.');
    const custom = rawCustom.map(c => A.norm(c));
    const next_ = A.normalizeAllergyList([...b.allergens, ...custom]); // folds "peanuts" etc. into keys
    const names = [...next_.keys.map(k => A.STORED_NAME[k]), ...next_.custom];
    const prisma = getPrisma();
    const before = await A.loadUserAllergies(prisma, req.userId);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.userId} FOR UPDATE`;
      const rows = [];
      for (const name of names) rows.push(await tx.allergy.upsert({ where: { name }, update: {}, create: { name } }));
      await tx.userAllergy.deleteMany({ where: { userId: req.userId } });
      if (rows.length) await tx.userAllergy.createMany({ data: rows.map(r => ({ userId: req.userId, allergyId: r.id })) });
    });
    const saved = await A.loadUserAllergies(prisma, req.userId);
    const changed = JSON.stringify(before) !== JSON.stringify(saved);
    const revalidation = await revalidateActivePlans(prisma, req.userId, saved);
    res.json({ ...view(saved), changed, revalidation });
  } catch (e) { next(e); }
});

module.exports = router;

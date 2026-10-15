const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
router.get('/', async (req, res, next) => {
  try { const user = await getPrisma().user.findUnique({ where: { id: req.userId }, select: { profileData: true } }); res.json({ profile: user?.profileData || null }); } catch(e) { next(e); }
});
router.put('/', async (req, res, next) => {
  try {
    const p = req.body;
    for (const [key, min, max] of [['age',18,120],['heightCm',50,260],['weightKg',20,400]]) {
      if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw httpError(400, `Invalid ${key}.`);
    }
    if (!['weight_loss','muscle_gain','body_recomposition','maintain'].includes(p.goal) || !['male','female','other'].includes(p.sex) || !['metric','imperial'].includes(p.units) || !['sedentary','light','moderate','active','very_active'].includes(p.activityLevel)) throw httpError(400, 'Invalid profile options.');
    const profile = Object.fromEntries(['name','sex','age','heightCm','weightKg','goalWeightKg','activityLevel','goal','units','createdAt'].filter(k => p[k] !== undefined).map(k => [k,p[k]]));
    const prisma = getPrisma();
    await prisma.$transaction(async tx => {
      const prev = await tx.user.findUnique({ where: { id: req.userId } });
      await tx.user.update({ where: { id: req.userId }, data: { profileData: profile, firstName: String(p.name || '').slice(0,100), gender: p.sex, heightCm: p.heightCm, currentWeightKg: p.weightKg, goalType: p.goal, activityLevel: p.activityLevel } });
      if (prev.currentWeightKg !== p.weightKg) await tx.weightEntry.create({ data: { userId: req.userId, weightKg: p.weightKg } });
      const { calculateBMR, calculateTDEE, targetCalories } = require('../services/calorieEngine');
      const caloriesTarget = Math.round(targetCalories(calculateTDEE(calculateBMR(p),p.activityLevel),p.goal));
      const existing = await tx.macroGoal.findUnique({ where: { userId: req.userId } });
      if (!existing || existing.source === 'default') {
        const proteinTarget = Math.round(p.weightKg * 1.6), fatTarget = Math.round(caloriesTarget * 0.25 / 9);
        const data = { caloriesTarget, proteinTarget, fatTarget, carbsTarget: Math.max(0,Math.round((caloriesTarget-proteinTarget*4-fatTarget*9)/4)), fiberTarget:30, waterMlTarget:2000, source:'default' };
        await tx.macroGoal.upsert({ where:{userId:req.userId},create:{userId:req.userId,...data},update:data });
      }
    });
    res.json({ profile });
  } catch(e) { next(e); }
});
module.exports = router;

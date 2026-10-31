// Exercise-library service: search, detail, alternatives, muscle heatmap.
const { getPrisma } = require('../lib/prisma');
const prisma = getPrisma();
const { MUSCLES } = require('./muscles');

const PAGE = 25;
const shape = e => ({
  id: e.id, name: e.name, level: e.level, force: e.force, mechanic: e.mechanic,
  equipment: e.equipment, appEquipment: e.appEquipment, category: e.category,
  primaryMuscles: e.muscles.filter(m => m.role === 'primary').map(m => m.muscle),
  secondaryMuscles: e.muscles.filter(m => m.role === 'secondary').map(m => m.muscle),
  instructions: e.instructions, source: e.source,
});

const searchExercises = async ({ q, muscle, role, equipment, mechanic, level, page = 1, limit = PAGE }) => {
  const where = {
    AND: [
      q ? { name: { contains: q, mode: 'insensitive' } } : {},
      muscle ? { muscles: { some: { muscle, ...(role ? { role } : {}) } } } : {},
      equipment ? { appEquipment: { has: equipment } } : {},
      mechanic ? { mechanic } : {},
      level ? { level } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.exercise.count({ where }),
    prisma.exercise.findMany({
      where, include: { muscles: true }, orderBy: { name: 'asc' },
      skip: (page - 1) * limit, take: limit,
    }),
  ]);
  return { total, page, limit, exercises: rows.map(shape) };
};

const getExercise = async id => {
  const e = await prisma.exercise.findUnique({ where: { id }, include: { muscles: true } });
  return e && shape(e);
};

// Explainable substitution scoring (initial ranking weights, not validated
// exercise-equivalence percentages): shared primary muscles 35, shared
// secondary 15, same force/pattern 25, equipment availability 20, difficulty 5.
const getAlternatives = async (id, { equipment } = {}) => {
  const base = await prisma.exercise.findUnique({ where: { id }, include: { muscles: true } });
  if (!base) return null;
  const primary = base.muscles.filter(m => m.role === 'primary').map(m => m.muscle);
  const secondary = base.muscles.filter(m => m.role === 'secondary').map(m => m.muscle);
  const allowed = equipment ? equipment.split(',') : null;
  const candidates = await prisma.exercise.findMany({
    where: {
      id: { not: id },
      muscles: { some: { muscle: { in: [...primary, ...secondary] }, role: 'primary' } },
      ...(allowed ? { appEquipment: { hasSome: allowed } } : {}),
    },
    include: { muscles: true },
  });
  const scored = candidates.map(c => {
    const cPrimary = c.muscles.filter(m => m.role === 'primary').map(m => m.muscle);
    const cSecondary = c.muscles.filter(m => m.role === 'secondary').map(m => m.muscle);
    const sharedPrimary = primary.filter(m => cPrimary.includes(m));
    if (!sharedPrimary.length) return null; // same-named muscle alone isn't enough
    let score = 0; const why = [];
    score += 35 * (sharedPrimary.length / Math.max(primary.length, 1));
    why.push(`targets ${sharedPrimary.map(m => MUSCLES[m]?.label || m).join(', ')}`);
    const sharedSecondary = secondary.filter(m => cPrimary.includes(m) || cSecondary.includes(m));
    score += 15 * (sharedSecondary.length / Math.max(secondary.length, 1));
    if (sharedSecondary.length) why.push(`also hits ${sharedSecondary.map(m => MUSCLES[m]?.label || m).join(', ')}`);
    if (c.force && c.force === base.force) { score += 25; why.push(`same ${c.force} pattern`); }
    if (base.appEquipment?.length && c.appEquipment?.length && c.appEquipment.every(e => base.appEquipment.includes(e) || (allowed && allowed.includes(e)))) {
      score += 20; why.push('fits your equipment');
    } else if (allowed && c.appEquipment?.some(e => allowed.includes(e))) { score += 20; why.push('fits your equipment'); }
    if (c.level === base.level) score += 5;
    else if (base.level === 'expert' || c.level === 'expert') score += 0;
    else score += 3;
    if (c.equipment !== base.equipment) why.push(`${c.equipment || 'no equipment'} instead of ${base.equipment || 'none'}`);
    return { exercise: shape(c), score: Math.round(score), why: why.join('; ') };
  }).filter(Boolean);
  scored.sort((a, b) => b.score - a.score);
  return { exercise: shape(base), alternatives: scored.slice(0, 8) };
};

// Muscle training exposure from completed sets (primary=1.0, secondary=0.5 —
// display weighting only, not physiological percentages).
const muscleHeatmap = async (userId, { days = 7 } = {}) => {
  const since = new Date(Date.now() - days * 86400e3);
  const sets = await prisma.exerciseSet.findMany({
    where: { workoutSession: { userId, finishedAt: { not: null }, endedAt: { gte: since } }, },
    include: { workoutSession: { select: { endedAt: true } } },
  });
  const names = [...new Set(sets.map(s => s.exerciseName))];
  const lib = names.length ? await prisma.exercise.findMany({
    where: { normalizedName: { in: names.map(n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) } },
    include: { muscles: true },
  }) : [];
  const bySlug = Object.fromEntries(lib.map(e => [e.normalizedName, e]));
  const out = {};
  for (const s of sets) {
    const slug = s.exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const ex = bySlug[slug];
    if (!ex) continue;
    for (const m of ex.muscles) {
      const w = m.role === 'primary' ? 1 : 0.5;
      const cur = out[m.muscle] || (out[m.muscle] = { sets: 0, volumeLoad: 0, sessions: new Set(), lastTrained: null });
      cur.sets += w;
      cur.volumeLoad += (s.reps || 0) * (s.weightLbs || 0) * w;
      cur.sessions.add(s.workoutSessionId);
      const at = s.workoutSession.endedAt;
      if (at && (!cur.lastTrained || at > cur.lastTrained)) cur.lastTrained = at;
    }
  }
  const maxSets = Math.max(1, ...Object.values(out).map(v => v.sets));
  return {
    days,
    muscles: Object.fromEntries(Object.entries(out).map(([m, v]) => [m, {
      sets: Math.round(v.sets * 10) / 10,
      sessions: v.sessions.size,
      volumeLoadLbs: Math.round(v.volumeLoad),
      lastTrained: v.lastTrained,
      intensity: Math.round((v.sets / maxSets) * 100) / 100, // 0..1 for heatmap shade
    }])),
  };
};

module.exports = { searchExercises, getExercise, getAlternatives, muscleHeatmap };

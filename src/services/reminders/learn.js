const { analyzeMeals, analyzeWater, analyzeSupplements, buildSuggestions } = require('./learning');
const { getPreferences } = require('./preferences');

const LOOKBACK_DAYS = 30;
const SUGGESTION_TTL_DAYS = 14;

function existingKeys(suggestions, settings) {
  const keys = new Set();
  for (const s of suggestions) {
    const e = s.evidence || {};
    if (s.category === 'water') keys.add('water');
    else if (s.category === 'supplement') keys.add(`supplement:${e.supplementName || ''}:${e.pattern || ''}`);
    else keys.add(`${s.category}:${e.pattern || 'weekday'}`);
  }
  // An enabled manual schedule fully owns its category — no suggestions for it.
  for (const s of settings) {
    if (!s.enabled || s.source !== 'manual') continue;
    keys.add(s.category);
    keys.add(`${s.category}:weekday`);
    keys.add(`${s.category}:weekend`);
  }
  return keys;
}

// Analyzes recent logs and records new pending suggestions. Requires both
// master opt-in and adaptive consent; muted users get nothing.
async function generateSuggestions(prisma, userId, { now = new Date() } = {}) {
  const prefs = await getPreferences(prisma, userId);
  if (!prefs.masterEnabled || !prefs.adaptiveEnabled || prefs.suggestionsMuted) return [];
  await prisma.reminderSuggestion.updateMany({
    where: { userId, status: 'pending', createdAt: { lt: new Date(now.getTime() - SUGGESTION_TTL_DAYS * 86400000) } },
    data: { status: 'expired', resolvedAt: now },
  });
  const timezone = prefs.timezone || 'UTC';
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  const [foodLogs, waterLogs, supplementLogs, open, settings] = await Promise.all([
    prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: since } }, select: { mealType: true, loggedAt: true } }),
    prisma.waterLog.findMany({ where: { userId, loggedAt: { gte: since } }, select: { loggedAt: true } }),
    prisma.supplementLog.findMany({ where: { userId, loggedAt: { gte: since } }, select: { supplementName: true, loggedAt: true } }),
    prisma.reminderSuggestion.findMany({ where: { userId, status: { in: ['pending', 'accepted'] } } }),
    prisma.reminderCategorySetting.findMany({ where: { userId } }),
  ]);
  const suggestions = buildSuggestions(
    {
      meals: analyzeMeals(foodLogs, timezone),
      water: analyzeWater(waterLogs, timezone),
      supplements: analyzeSupplements(supplementLogs, timezone),
    },
    existingKeys(open, settings),
  );
  const created = [];
  for (const s of suggestions) {
    created.push(await prisma.reminderSuggestion.create({ data: { userId, ...s } }));
  }
  return created;
}

module.exports = { generateSuggestions };

const { createPersistentLimiter } = require('./persistentLimiter');
const { consumeLimit } = require('./authLifecycle');
const { httpError } = require('../lib/errors');
function config() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw httpError(503, 'AI service is not configured. Use food search or manual logging.');
  const userLimit = Number(process.env.FOOD_AI_USER_DAILY_LIMIT || 30);
  const globalLimit = Number(process.env.FOOD_AI_GLOBAL_DAILY_LIMIT || 100);
  if (![userLimit, globalLimit].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000)) throw httpError(503, 'Food analysis configuration is invalid.');
  return { userLimit, globalLimit };
}
async function reserveFoodRequest(userId) {
  const { userLimit, globalLimit } = config();
  const now = new Date(), day = now.toISOString().slice(0, 10);
  const retryAfter = Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86400000 - +now) / 1000);
  if (!userLimit || !globalLimit) return { allowed: false, retryAfter };
  const user = await createPersistentLimiter({ limit: userLimit, kind: 'food-ai' }).consume(userId);
  if (!user.allowed) return { allowed: false, retryAfter };
  // A persistent shared attempt budget limits spend across instances and users.
  // Reserve before sending; failures also count, and SDK retries are disabled.
  const allowed = await consumeLimit('food-ai-global', day, globalLimit, retryAfter * 1000);
  return { allowed, retryAfter };
}
module.exports = { reserveFoodRequest, config };

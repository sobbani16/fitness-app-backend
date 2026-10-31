const { httpError } = require('../lib/errors');

// Paid-call gate: AI features stay off until explicitly enabled.
const aiEnabled = () => process.env.AI_ENABLED === 'true' || process.env.NODE_ENV === 'test';

// Startup validation — reports presence only, never the secret.
if (!process.env.OPENAI_API_KEY?.trim()) console.warn('[ai] OPENAI_API_KEY not set; AI features will return 503.');

// Per-user daily call quota + token accounting (in-process; move to Redis/DB
// if multi-instance). Key never leaves this module.
const usage = new Map(); // `${userId}:${yyyymmdd}` -> { calls, tokens }
const DAILY_CALL_CAP = Number(process.env.AI_USER_DAILY_CALL_CAP || 20);
const DAILY_TOKEN_CAP = Number(process.env.AI_USER_DAILY_TOKEN_CAP || 50000);
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

function checkQuota(userId, estimatedTokens = 3000) {
  const key = `${userId || 'anon'}:${today()}`;
  const u = usage.get(key) || { calls: 0, tokens: 0 };
  if (u.calls >= DAILY_CALL_CAP || u.tokens + estimatedTokens > DAILY_TOKEN_CAP) {
    throw httpError(429, 'Daily AI usage limit reached. Try again tomorrow or use manual entry.');
  }
  // Reserve synchronously before the network await. Failures still consume an
  // attempt and its token reservation, preventing parallel/retry quota bypass.
  usage.set(key, { calls: u.calls + 1, tokens: u.tokens + estimatedTokens });
  for (const oldKey of usage.keys()) if (!oldKey.endsWith(`:${today()}`)) usage.delete(oldKey);
  return key;
}

function recordUsage(key, result, reservedTokens) {
  const u = usage.get(key) || { calls: 0, tokens: 0 };
  if (Number.isFinite(result?.usage?.total_tokens)) u.tokens += result.usage.total_tokens - reservedTokens;
  usage.set(key, u);
}

function aiUsage(userId) {
  const u = usage.get(`${userId}:${today()}`);
  return { callsToday: u?.calls || 0, tokensToday: u?.tokens || 0, callCap: DAILY_CALL_CAP };
}

async function askJSON(name, properties, instructions, text, imageDataUrl, userId, options = {}) {
  if (!aiEnabled()) throw httpError(503, 'AI features are not enabled on this server.');
  if (!process.env.OPENAI_API_KEY?.trim()) throw httpError(503, 'AI service is not configured. Use manual logging or food search.');
  if (imageDataUrl) require('./foodInput').validateFoodInput({ imageDataUrl });
  const maxOutputTokens = Math.min(8000, Math.max(500, Number(options.maxOutputTokens) || 1500));
  const reservedTokens = imageDataUrl ? 4000 : Math.max(2000, maxOutputTokens);
  const quotaKey = checkQuota(userId, reservedTokens);
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 });
  const content = [{ type: 'input_text', text }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl, detail: 'auto' });
  let result;
  try {
    result = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini', store: false, instructions,
      input: [{ role: 'user', content }], max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name, strict: true, schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } },
    });
  } catch (e) {
    if (e.status === 429) throw httpError(503, 'AI capacity is temporarily unavailable. Use food search or try later.');
    if (e.name === 'APIConnectionTimeoutError') throw httpError(504, 'AI analysis timed out. Try again or use food search.');
    throw httpError(502, 'AI service could not complete this request. Please retry or enter values manually.');
  }
  recordUsage(quotaKey, result, reservedTokens);
  if (result.output?.some(item => item.content?.some(part => part.type === 'refusal'))) throw httpError(422, 'This input could not be analyzed. Try another photo or use food search.');
  try {
    if (result.status !== 'completed' || !result.output_text) throw new Error('Incomplete response');
    return JSON.parse(result.output_text);
  } catch {
    throw httpError(502, 'AI service returned an incomplete estimate. Please retry or enter values manually.');
  }
}
module.exports = { askJSON, aiEnabled, aiUsage };

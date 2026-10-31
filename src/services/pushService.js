// Device push tokens + Expo push transport.
// Push is strictly best-effort: registration is durable, sends never throw into
// the caller's flow and never carry message content (generic bodies only).
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PLATFORMS = new Set(['ios', 'android']);

/** Upsert a device token for the user (token is globally unique). */
async function registerToken(userId, { token, platform } = {}) {
  const t = String(token || '').trim();
  const p = String(platform || '').trim().toLowerCase();
  if (!t) throw httpError(400, 'token required.');
  if (!PLATFORMS.has(p)) throw httpError(400, 'platform must be ios or android.');
  return getPrisma().devicePushToken.upsert({
    where: { token: t },
    update: { userId, platform: p },
    create: { userId, token: t, platform: p },
  });
}

/** Remove one of the caller's tokens (idempotent). */
async function removeToken(userId, token) {
  const t = String(token || '').trim();
  if (!t) throw httpError(400, 'token required.');
  await getPrisma().devicePushToken.deleteMany({ where: { userId, token: t } });
  return { removed: true };
}

/**
 * Send an Expo push to every registered device of a user.
 * NEVER throws: transport failures, missing fetch, and empty token lists all
 * resolve to { sent: 0 }. Callers must treat push as fire-and-forget.
 */
async function sendPushToUser(userId, { title, body, data } = {}) {
  try {
    if (typeof fetch !== 'function') return { sent: 0 };
    const rows = await getPrisma().devicePushToken.findMany({ where: { userId } });
    const tokens = [...new Set((rows || []).map((r) => r && r.token).filter(Boolean))];
    if (!tokens.length) return { sent: 0 };
    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title: String(title || '').slice(0, 128),
      body: String(body || '').slice(0, 256),
      ...(data && typeof data === 'object' ? { data } : {}),
    }));
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    return { sent: res && res.ok ? tokens.length : 0 };
  } catch (err) {
    return { sent: 0 };
  }
}

module.exports = { registerToken, removeToken, sendPushToUser };

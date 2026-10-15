const { getPrisma } = require('../lib/prisma');
const { hashToken } = require('./authService');
const { actionToken } = require('./authLifecycle');
async function sendEmail(action) {
  if (hashToken(actionToken(action.id)) !== action.tokenHash) throw new Error('Auth link signing key changed; request a new email.');
  const url = new URL(`/auth/action#${new URLSearchParams({ purpose: action.purpose, token: actionToken(action.id) })}`, process.env.AUTH_PUBLIC_URL).href;
  const reset = action.purpose === 'reset-password';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `auth-action/${action.id}` },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [action.email],
      subject: reset ? 'Reset your Fitness password' : 'Verify your Fitness email',
      text: `${reset ? 'Choose a new password' : 'Confirm your email address'}: ${url}\n\nThis single-use link expires at ${action.expiresAt.toISOString()}. If you did not request this, ignore this email. Never share this link.` })
  });
  if (!response.ok) throw new Error(`Email delivery HTTP ${response.status}`);
}
async function drainEmails(send = sendEmail) {
  const prisma = getPrisma();
  // Claim one at a time. The lease exceeds the network timeout; idempotency covers crashes.
  for (let i = 0; i < 20; i++) {
    const rows = await prisma.$queryRaw`
      UPDATE "AuthAction" SET "nextAttemptAt" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '60 seconds', "attempts" = "attempts" + 1
      WHERE "id" = (SELECT "id" FROM "AuthAction" WHERE "deliveredAt" IS NULL AND "consumedAt" IS NULL
        AND "expiresAt" > (NOW() AT TIME ZONE 'UTC') AND "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC') AND "attempts" < 5
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    if (!rows.length) break;
    const action = rows[0];
    try {
      await send(action);
      await prisma.authAction.update({ where: { id: action.id }, data: { deliveredAt: new Date() } });
    } catch {
      // Never log recipients, links, response bodies, or tokens.
      console.error('Auth email delivery failed', { jobId: action.id, attempt: action.attempts });
      await prisma.authAction.update({ where: { id: action.id }, data: { nextAttemptAt: new Date(Date.now() + 30000 * 2 ** action.attempts) } });
    }
  }
}
function startEmailWorker() {
  let stopped = false, timer, running = Promise.resolve(), nextCleanup = 0;
  const tick = () => {
    running = (async () => {
      if (Date.now() >= nextCleanup) {
        await require('./accountRetention').pruneRetainedRecords();
        nextCleanup = Date.now() + 3600000;
      }
      await drainEmails();
    })().catch(() => console.error('Auth email queue unavailable')).finally(() => {
      if (!stopped) { timer = setTimeout(tick, 5000); timer.unref(); }
    });
  };
  tick();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}
module.exports = { sendEmail, drainEmails, startEmailWorker };

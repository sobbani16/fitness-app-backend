// Weekly adaptive-target review — run via cron/Railway scheduled task (e.g.
// Mondays 06:00 UTC). Idempotent per user per ISO week via targetReviewedWeek;
// manual/paused modes are never touched; failures per user don't stop the run.
const { getPrisma } = require('../src/lib/prisma');
const { assignWeeklyTarget, weekKey } = require('../src/services/progressCalendar');

const BATCH = 200;

async function main() {
  const prisma = getPrisma();
  const now = new Date();
  const wk = weekKey(now);
  // Users with any V2 progress record — groupBy avoids a full user table scan.
  const groups = await prisma.dailyProgressDay.groupBy({ by: ['userId'] });
  const stats = { users: groups.length, reviewed: 0, changed: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < groups.length; i += BATCH) {
    const batch = groups.slice(i, i + BATCH);
    for (const { userId } of batch) {
      try {
        const r = await assignWeeklyTarget(userId, { now });
        if (r.reason === 'already_reviewed' || r.reason === 'user_controlled' || r.reason === 'insufficient_coverage' || r.reason === 'steady') stats.skipped += 1;
        else { stats.reviewed += 1; if (r.changed) stats.changed += 1; }
      } catch (err) {
        stats.failed += 1;
        console.error(`[weekly-target-review] user ${userId}: ${err.message}`);
      }
    }
  }
  console.log(`[weekly-target-review] ${wk} — ${JSON.stringify(stats)}`);
  await prisma.$disconnect();
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

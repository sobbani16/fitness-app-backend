// Weekly Knowledge Academy publisher — durable, idempotent, Railway-cron safe.
// Runs (e.g.) Sundays 09:00 in PUBLISH_TZ. Picks the due scheduled slot,
// revalidates publishability (immutable approved revision, resolvable refs,
// no open corrections), publishes once, then fans out ONE notification to
// opted-in WEEKLY_FITNESS_EDUCATION users. Never publishes unapproved content;
// on a blocked week it alerts the editorial team instead of faking an edition.
const { getPrisma } = require('../src/lib/prisma');
const audit = require('../src/services/auditService');
const { validatePublishable } = require('../src/routes/editorial');

const CATEGORY = 'WEEKLY_FITNESS_EDUCATION';
const dry = process.argv.includes('--dry-run');

async function main() {
  const prisma = getPrisma();
  const now = new Date();

  const due = await prisma.editorialSchedule.findMany({
    where: { status: 'scheduled', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
  });
  if (!due.length) { console.log(JSON.stringify({ published: 0, message: 'nothing due' })); return; }

  for (const slot of due) {
    // Idempotency: bail if a publication event already exists for this slot.
    const existing = await prisma.publicationEvent.findUnique({ where: { scheduleId: slot.id } });
    if (existing) continue;

    const v = await validatePublishable(slot.articleId);
    if (!v.ok) {
      await prisma.editorialSchedule.update({ where: { id: slot.id }, data: { status: 'blocked', blockedReason: v.reason } });
      // Alert editorial roles — never send a false "new article" notification.
      const editors = await prisma.userRole.findMany({
        where: { active: true, role: { name: { in: ['EDITOR', 'SUPER_ADMIN'] } } }, select: { userId: true },
      });
      for (const e of editors) {
        await prisma.notification.create({ data: { userId: e.userId, type: 'editorial_blocked', title: 'Weekly edition blocked', body: `Publication "${slot.publishKey}" is blocked: ${v.reason}.` } });
      }
      console.log(JSON.stringify({ publishKey: slot.publishKey, blocked: v.reason }));
      continue;
    }

    if (dry) { console.log(JSON.stringify({ publishKey: slot.publishKey, wouldPublish: v.revision.title })); continue; }

    const published = await prisma.$transaction(async tx => {
      const event = await tx.publicationEvent.create({ data: { scheduleId: slot.id, articleId: v.article.id, revisionId: v.article.approvedRevisionId, kind: 'weekly', scheduledFor: slot.scheduledFor } });
      await tx.editorialSchedule.update({ where: { id: slot.id }, data: { status: 'published', publishedAt: new Date() } });
      await tx.knowledgeArticle.update({ where: { id: v.article.id }, data: { status: 'published', publishedRevisionId: v.article.approvedRevisionId, publishedAt: new Date() } });
      return event;
    });
    await audit.log({ actorId: 'system:weekly-publish', action: 'article.publish.weekly', entityType: 'KnowledgeArticle', entityId: v.article.id, afterData: { publishKey: slot.publishKey } });

    // Fan out to opted-in subscribers — deduped by checking for an existing
    // notification for this event.
    const subs = await prisma.reminderCategorySetting.findMany({ where: { category: CATEGORY, enabled: true }, select: { userId: true } });
    const link = `/learn/${v.article.slug}`;
    let sent = 0;
    for (const s of subs) {
      const dup = await prisma.notification.findFirst({ where: { userId: s.userId, type: 'weekly_education', body: { contains: link } } });
      if (dup) continue;
      await prisma.notification.create({ data: { userId: s.userId, type: 'weekly_education', title: 'This week’s Myth vs Fact', body: `${v.revision.claim} — ${v.revision.shortVerdict.slice(0, 120)} ${link}`.slice(0, 220) } });
      sent++;
    }
    await prisma.publicationEvent.update({ where: { id: published.id }, data: { notifiedAt: new Date() } });
    console.log(JSON.stringify({ publishKey: slot.publishKey, published: true, notified: sent }));
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => getPrisma().$disconnect());

// Retention sweep — run via cron/Railway scheduled task.
// Policies (days, env-overridable):
//   group messages:       GROUP_MESSAGE_RETENTION_DAYS (default 730)
//   ended video sessions: VIDEO_SESSION_RETENTION_DAYS (metadata; default 730)
//   resolved reports:     REPORT_RETENTION_DAYS (default 365)
//   revoked documents:    DOC_REVOKED_RETENTION_DAYS (delete file; default 90)
// Recordings/AI transcripts are out of scope until those features activate.
require('dotenv').config();
const { getPrisma } = require('../src/lib/prisma');
const fs = require('node:fs');
const path = require('node:path');
const prisma = getPrisma();
const days = n => new Date(Date.now() - n * 86400000);
const env = (k, d) => Number(process.env[k] || d);

(async () => {
  const groupMsg = await prisma.groupMessage.deleteMany({
    where: { createdAt: { lt: days(env('GROUP_MESSAGE_RETENTION_DAYS', 730)) } },
  });
  const sessions = await prisma.videoSession.updateMany({
    where: { status: { in: ['ended', 'cancelled'] }, endedAt: { lt: days(env('VIDEO_SESSION_RETENTION_DAYS', 730)) }, purpose: { not: null } },
    data: { purpose: null }, // scrub free text after retention window
  });
  const reports = await prisma.messageReport.deleteMany({
    where: { status: { in: ['resolved', 'dismissed'] }, resolvedAt: { lt: days(env('REPORT_RETENTION_DAYS', 365)) } },
  });
  // Revoked documents past retention → delete file + row.
  const staleDocs = await prisma.trainerDocument.findMany({
    where: { status: 'revoked', updatedAt: { lt: days(env('DOC_REVOKED_RETENTION_DAYS', 90)) } },
  });
  const docStorage = require('../src/lib/docStorage');
  let docRows = 0;
  for (const d of staleDocs) {
    await docStorage.remove(d.fileKey);
    await prisma.trainerDocument.delete({ where: { id: d.id } });
    docRows++;
  }
  console.log(JSON.stringify({ groupMessagesDeleted: groupMsg.count, sessionsScrubbed: sessions.count, reportsDeleted: reports.count, revokedDocsDeleted: docRows }));
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });

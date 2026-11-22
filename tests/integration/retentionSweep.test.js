// Retention-sweep job test — runs the real cron script (scripts/retention-sweep.js)
// as a child process against the disposable fitness_auth_readiness DB.
// Skips (not fails) under the default suite run.
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
const SAFE_DB = ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/fitness_auth_readiness';
const prisma = SAFE_DB ? new PrismaClient() : null;
const d = SAFE_DB ? describe : describe.skip;
const days = n => new Date(Date.now() - n * 86400000);

function runSweep(env = {}) {
  const out = execFileSync('node', ['scripts/retention-sweep.js'], {
    cwd: require('path').join(__dirname, '..', '..'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

async function seed() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@sweep.test`, passwordHash: 'x' } });
  const client = await prisma.user.create({ data: { email: `${randomUUID()}@sweep.test`, passwordHash: 'x' } });
  const trainer = await prisma.trainerProfile.create({ data: { userId: user.id } });
  const relation = await prisma.trainerClient.create({ data: { trainerId: trainer.id, clientId: client.id, status: 'active' } });
  const group = await prisma.coachingGroup.create({ data: { name: 'g', trainerId: trainer.id } });
  return { user, client, trainer, relation, group };
}

d('retention-sweep cron job', () => {
  test('deletes expired records, keeps fresh ones, is idempotent', async () => {
    const { user, relation, group } = await seed();
    const OLD = days(40), NEW = days(5);
    // group messages: old→deleted, new→kept
    const mOld = await prisma.groupMessage.create({ data: { groupId: group.id, senderId: user.id, body: 'old', createdAt: OLD } });
    const mNew = await prisma.groupMessage.create({ data: { groupId: group.id, senderId: user.id, body: 'new', createdAt: NEW } });
    // video sessions: ended+old purpose → scrubbed; live purpose → kept
    const sOld = await prisma.videoSession.create({ data: { relationId: relation.id, roomName: `r-${randomUUID()}`, status: 'ended', endedAt: OLD, purpose: 'check-in', scheduledStart: OLD, scheduledEnd: OLD } });
    const sNew = await prisma.videoSession.create({ data: { relationId: relation.id, roomName: `r-${randomUUID()}`, status: 'ended', endedAt: NEW, purpose: 'keep', scheduledStart: NEW, scheduledEnd: NEW } });
    // reports: resolved+old→deleted; open+old→kept
    const rOld = await prisma.messageReport.create({ data: { messageKind: 'dm', messageId: 'm1', reporterId: user.id, reason: 'spam', status: 'resolved', resolvedAt: OLD, createdAt: OLD } });
    const rOpen = await prisma.messageReport.create({ data: { messageKind: 'dm', messageId: 'm2', reporterId: user.id, reason: 'spam', status: 'open', createdAt: OLD } });
    // revoked docs: old→row removed (file removal depends on storage); recent→kept
    const docOld = await prisma.trainerDocument.create({ data: { trainerId: relation.trainerId, title: 'old doc', fileKey: `test/${randomUUID()}.pdf`, fileName: 'o.pdf', sizeBytes: 1, status: 'revoked', updatedAt: OLD } });
    const docNew = await prisma.trainerDocument.create({ data: { trainerId: relation.trainerId, title: 'new doc', fileKey: `test/${randomUUID()}.pdf`, fileName: 'n.pdf', sizeBytes: 1, status: 'revoked', updatedAt: NEW } });

    const out = runSweep({
      GROUP_MESSAGE_RETENTION_DAYS: '30', VIDEO_SESSION_RETENTION_DAYS: '30',
      REPORT_RETENTION_DAYS: '30', DOC_REVOKED_RETENTION_DAYS: '30',
    });
    expect(out.groupMessagesDeleted).toBeGreaterThanOrEqual(1);
    expect(out.reportsDeleted).toBeGreaterThanOrEqual(1);
    expect(out.revokedDocsDeleted).toBeGreaterThanOrEqual(1);

    expect(await prisma.groupMessage.findUnique({ where: { id: mOld.id } })).toBeNull();
    expect(await prisma.groupMessage.findUnique({ where: { id: mNew.id } })).not.toBeNull();
    expect((await prisma.videoSession.findUnique({ where: { id: sOld.id } })).purpose).toBeNull();
    expect((await prisma.videoSession.findUnique({ where: { id: sNew.id } })).purpose).toBe('keep');
    expect(await prisma.messageReport.findUnique({ where: { id: rOld.id } })).toBeNull();
    expect(await prisma.messageReport.findUnique({ where: { id: rOpen.id } })).not.toBeNull();
    expect(await prisma.trainerDocument.findUnique({ where: { id: docOld.id } })).toBeNull();
    expect(await prisma.trainerDocument.findUnique({ where: { id: docNew.id } })).not.toBeNull();

    // Idempotent: second run sweeps nothing new for these rows.
    const out2 = runSweep({ GROUP_MESSAGE_RETENTION_DAYS: '30', VIDEO_SESSION_RETENTION_DAYS: '30', REPORT_RETENTION_DAYS: '30', DOC_REVOKED_RETENTION_DAYS: '30' });
    expect(out2.groupMessagesDeleted).toBe(0);
    expect(out2.reportsDeleted).toBe(0);

    // Cleanup our fixtures
    await prisma.groupMessage.deleteMany({ where: { groupId: group.id } });
    await prisma.videoSession.deleteMany({ where: { relationId: relation.id } });
    await prisma.messageReport.deleteMany({ where: { reporterId: user.id } });
    await prisma.trainerDocument.deleteMany({ where: { trainerId: relation.trainerId } });
    await prisma.coachingGroup.delete({ where: { id: group.id } });
    await prisma.trainerClient.delete({ where: { id: relation.id } });
    await prisma.trainerProfile.delete({ where: { id: relation.trainerId } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, relation.clientId] } } });
  }, 30000);
});

afterAll(async () => { if (prisma) await prisma.$disconnect(); });

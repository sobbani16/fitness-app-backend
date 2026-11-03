// Editorial + Super Admin workspace for the Knowledge Academy.
// Mounted at /editorial (workspace) and /super-admin (control center).
// Every write is audited; approval requires an independent reviewer; a
// published revision is immutable — corrections create a NEW revision.
const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const audit = require('../services/auditService');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const { requirePermission } = require('../middleware/rbac');

const router = require('../lib/asyncRouter')();
const prisma = getPrisma();
const { VERDICTS, CATEGORIES } = require('./academy');

router.use(requireFeature('knowledge_academy_enabled'), identifyUser);

const AUTHOR = requirePermission('ACADEMY_AUTHOR');
const REVIEW = requirePermission('ACADEMY_REVIEW');
const CLINICAL = requirePermission('ACADEMY_CLINICAL_REVIEW');
const PUBLISH = requirePermission('ACADEMY_PUBLISH');
const MANAGE_REVIEWERS = requirePermission('MANAGE_REVIEWERS');
const ENTITLEMENTS = requirePermission('MANAGE_ENTITLEMENTS');
const PANEL = requirePermission('SUPER_ADMIN_PANEL');

const editable = ['draft', 'researching', 'changes_requested'];
const STATUS = [...editable, 'ready_for_review', 'approved', 'scheduled', 'published', 'correction_required', 'retracted', 'archived'];

// ---------------------------------------------------------------------------
// RESEARCH LIBRARY — stable citation records
// ---------------------------------------------------------------------------
router.get('/sources', AUTHOR, async (req, res) => {
  const rows = await prisma.researchSource.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 });
  res.json({ sources: rows });
});

router.post('/sources', AUTHOR, async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) throw httpError(400, 'title required.');
  const key = b.doi ? `doi:${String(b.doi).toLowerCase()}` : b.pmid ? `pmid:${b.pmid}` : `url:${String(b.url || title).toLowerCase()}`;
  if (!b.doi && !b.pmid && !b.url) throw httpError(400, 'Provide a DOI, PMID, or stable URL — citations must be verifiable.');
  const data = {
    key, title, journal: b.journal || null, year: b.year ? Number(b.year) : null,
    doi: b.doi || null, pmid: b.pmid || null, url: b.url || null,
    authors: Array.isArray(b.authors) ? b.authors : null,
    studyType: b.studyType || null, population: b.population || null,
    intervention: b.intervention || null, comparator: b.comparator || null,
    outcomes: b.outcomes || null, resultsSummary: b.resultsSummary || null,
    limitations: b.limitations || null, verifiedAt: new Date(),
  };
  const source = await prisma.researchSource.upsert({ where: { key }, update: data, create: data });
  res.status(201).json({ source });
});

router.patch('/sources/:id/status', PUBLISH, async (req, res) => {
  const { status, detail } = req.body || {};
  if (!['active', 'retracted', 'corrected', 'unavailable'].includes(status)) throw httpError(400, 'Bad status.');
  const src = await prisma.researchSource.update({ where: { id: req.params.id }, data: { status } });
  // Flag every published article citing this source for re-review.
  const affected = await prisma.articleEvidence.findMany({ where: { sourceId: src.id, revision: { article: { status: 'published' } } }, select: { revision: { select: { articleId: true, id: true } } } });
  for (const e of affected) {
    await prisma.knowledgeArticle.update({ where: { id: e.revision.articleId }, data: { status: 'correction_required' } });
    await prisma.contentCorrection.create({ data: { articleId: e.revision.articleId, revisionId: e.revision.id, kind: status === 'retracted' ? 'retraction' : 'source_unavailable', detail: detail || `Source ${src.key} marked ${status}.`, createdById: req.userId } });
  }
  await audit.log({ actorId: req.userId, action: 'source.status', entityType: 'ResearchSource', entityId: src.id, afterData: { status, affected: affected.length } });
  res.json({ source: src, flaggedArticles: affected.length });
});

// ---------------------------------------------------------------------------
// ARTICLES — draft → review → approve → schedule → publish
// ---------------------------------------------------------------------------
router.get('/articles', AUTHOR, async (req, res) => {
  const mine = req.query.mine === '1';
  const rows = await prisma.knowledgeArticle.findMany({
    where: mine ? { authorId: req.userId } : {},
    orderBy: { updatedAt: 'desc' }, take: 100,
    include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  res.json({ articles: rows.map(a => ({ id: a.id, slug: a.slug, category: a.category, status: a.status, title: a.revisions[0]?.title, version: a.revisions[0]?.version, updatedAt: a.updatedAt, publishedAt: a.publishedAt })) });
});

router.get('/articles/:id', AUTHOR, async (req, res) => {
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id }, include: {
    revisions: { orderBy: { version: 'desc' }, include: { evidence: { include: { source: true } } } },
    reviews: { orderBy: { createdAt: 'desc' }, take: 10 },
    schedule: { orderBy: { scheduledFor: 'desc' }, take: 5 },
    corrections: true,
  } });
  if (!a) throw httpError(404, 'Not found.');
  res.json({ article: a });
});

const slugify = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90);

router.post('/articles', AUTHOR, async (req, res) => {
  const { title, claim, category, tags, slug: inSlug } = req.body || {};
  if (!title || !claim) throw httpError(400, 'title and claim required.');
  if (!CATEGORIES.includes(category)) throw httpError(400, `category must be one of: ${CATEGORIES.join(', ')}`);
  let slug = inSlug ? slugify(inSlug) : slugify(title);
  if (await prisma.knowledgeArticle.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const article = await prisma.knowledgeArticle.create({
    data: { slug, category, tags: tags || [], authorId: req.userId, status: 'draft' },
  });
  const rev = await prisma.knowledgeArticleRevision.create({
    data: { articleId: article.id, version: 1, title: String(title).slice(0, 200), claim: String(claim).slice(0, 500), verdict: 'CONTEXT_DEPENDENT', shortVerdict: '', explanation: '', createdById: req.userId },
  });
  await prisma.knowledgeArticle.update({ where: { id: article.id }, data: { currentRevisionId: rev.id } });
  await audit.log({ actorId: req.userId, action: 'article.create', entityType: 'KnowledgeArticle', entityId: article.id });
  res.status(201).json({ article, revision: rev });
});

// Edit the working draft — published/approved revisions are immutable; editing
// an approved article invalidates approval by requiring a fresh revision.
router.put('/articles/:id/draft', AUTHOR, async (req, res) => {
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } });
  if (!a) throw httpError(404, 'Not found.');
  const b = req.body || {};
  const needsNewRevision = ['approved', 'scheduled', 'published', 'correction_required'].includes(a.status);
  if (!needsNewRevision && !editable.includes(a.status)) throw httpError(409, `Article is ${a.status}.`);
  const current = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.currentRevisionId || '' } });
  if (b.verdict && !VERDICTS.includes(b.verdict)) throw httpError(400, `verdict must be one of: ${VERDICTS.join(', ')}`);
  if (b.certainty && !['HIGH', 'MODERATE', 'LOW', 'VERY_LOW', 'NOT_ASSESSED'].includes(b.certainty)) throw httpError(400, 'Bad certainty.');
  if (b.certainty && b.certainty !== 'NOT_ASSESSED' && !b.certaintyRationale) throw httpError(400, 'certaintyRationale required when certainty is assessed.');

  let rev;
  if (needsNewRevision) {
    // Editing approved/published content → new draft revision; approval no
    // longer applies (approvedRevisionId stays for audit, not reuse).
    const version = (await prisma.knowledgeArticleRevision.count({ where: { articleId: a.id } })) + 1;
    rev = await prisma.knowledgeArticleRevision.create({
      data: {
        articleId: a.id, version,
        title: b.title ?? current?.title ?? a.slug, claim: b.claim ?? current?.claim ?? '',
        verdict: b.verdict ?? current?.verdict ?? 'CONTEXT_DEPENDENT',
        shortVerdict: b.shortVerdict ?? current?.shortVerdict ?? '', explanation: b.explanation ?? current?.explanation ?? '',
        takeaway: b.takeaway ?? current?.takeaway, appliesTo: b.appliesTo ?? current?.appliesTo,
        exceptions: b.exceptions ?? current?.exceptions, uncertainty: b.uncertainty ?? current?.uncertainty,
        certainty: b.certainty ?? current?.certainty ?? 'NOT_ASSESSED',
        certaintyRationale: b.certaintyRationale ?? current?.certaintyRationale,
        aiAssisted: Boolean(b.aiAssisted), createdById: req.userId,
      },
    });
    // A published article keeps serving its published revision publicly while
    // the new draft revision goes through a fresh review cycle.
    const nextStatus = a.status === 'published' ? 'published' : 'draft';
    await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { currentRevisionId: rev.id, status: nextStatus, ...(a.status === 'published' ? {} : { approvedRevisionId: null }) } });
  } else {
    if (!current || current.immutable) throw httpError(409, 'Revision is immutable — create a new draft.');
    rev = await prisma.knowledgeArticleRevision.update({ where: { id: current.id }, data: {
      ...(b.title !== undefined && { title: String(b.title).slice(0, 200) }),
      ...(b.claim !== undefined && { claim: String(b.claim).slice(0, 500) }),
      ...(b.verdict && { verdict: b.verdict }),
      ...(b.shortVerdict !== undefined && { shortVerdict: String(b.shortVerdict).slice(0, 300) }),
      ...(b.explanation !== undefined && { explanation: b.explanation }),
      ...(b.takeaway !== undefined && { takeaway: b.takeaway }),
      ...(b.appliesTo !== undefined && { appliesTo: b.appliesTo }),
      ...(b.exceptions !== undefined && { exceptions: b.exceptions }),
      ...(b.uncertainty !== undefined && { uncertainty: b.uncertainty }),
      ...(b.certainty && { certainty: b.certainty }),
      ...(b.certaintyRationale !== undefined && { certaintyRationale: b.certaintyRationale }),
      ...(b.aiAssisted !== undefined && { aiAssisted: Boolean(b.aiAssisted) }),
    } });
    if (a.status === 'changes_requested') await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { status: 'draft' } });
  }
  await audit.log({ actorId: req.userId, action: 'article.draft', entityType: 'KnowledgeArticleRevision', entityId: rev.id, afterData: { version: rev.version } });
  res.json({ revision: rev });
});

// Attach evidence to the working revision — sources must already exist
// (created via /sources with a verifiable identifier). No citation fabrication.
router.put('/articles/:id/evidence', AUTHOR, async (req, res) => {
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } });
  if (!a) throw httpError(404, 'Not found.');
  const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.currentRevisionId || '' } });
  if (!rev || rev.immutable) throw httpError(409, 'Working revision is immutable.');
  const items = Array.isArray(req.body?.sources) ? req.body.sources : [];
  const keys = items.map(i => String(i.key));
  const found = await prisma.researchSource.findMany({ where: { key: { in: keys } } });
  if (found.length !== keys.length) throw httpError(400, 'Unknown source key(s) — register sources in the research library first.');
  await prisma.articleEvidence.deleteMany({ where: { revisionId: rev.id } });
  for (let i = 0; i < items.length; i++) {
    const src = found.find(f => f.key === keys[i]);
    await prisma.articleEvidence.create({ data: { revisionId: rev.id, sourceId: src.id, supports: String(items[i].supports || '').slice(0, 300) || null, position: i } });
  }
  res.json({ attached: found.length });
});

router.post('/articles/:id/submit', AUTHOR, async (req, res) => {
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } });
  const canSubmit = a && (editable.includes(a.status) || a.status === 'published');
  if (!canSubmit) throw httpError(409, `Article is ${a?.status}.`);
  const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.currentRevisionId || '' }, include: { evidence: true } });
  if (!rev.explanation || rev.explanation.length < 40) throw httpError(400, 'Explanation is too thin for review.');
  if (!rev.evidence.length) throw httpError(400, 'At least one verified research source is required.');
  await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { status: 'ready_for_review' } });
  await audit.log({ actorId: req.userId, action: 'article.submit', entityType: 'KnowledgeArticle', entityId: a.id });
  res.json({ status: 'ready_for_review' });
});

// Review queue — articles ready for review, excluding ones the reviewer wrote.
router.get('/reviews', REVIEW, async (req, res) => {
  const rows = await prisma.knowledgeArticle.findMany({
    where: { status: 'ready_for_review', authorId: { not: req.userId } },
    include: { revisions: { orderBy: { version: 'desc' }, take: 1, include: { evidence: { include: { source: true } } } } },
    orderBy: { updatedAt: 'asc' },
  });
  res.json({ queue: rows.map(a => ({ id: a.id, slug: a.slug, category: a.category, title: a.revisions[0]?.title, claim: a.revisions[0]?.claim, verdict: a.revisions[0]?.verdict, sources: a.revisions[0]?.evidence.length, updatedAt: a.updatedAt })) });
});

router.post('/articles/:id/review', REVIEW, async (req, res) => {
  const { decision, feedback, scope } = req.body || {};
  if (!['approved', 'changes_requested'].includes(decision)) throw httpError(400, 'decision: approved|changes_requested.');
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } });
  if (!a || a.status !== 'ready_for_review') throw httpError(409, `Article is ${a?.status}.`);
  if (a.authorId === req.userId) throw httpError(403, 'Authors cannot review their own article.');
  const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.currentRevisionId || '' } });
  if (scope === 'clinical') {
    // Clinical-scope claims need a clinical reviewer — enforced by permission,
    // not a checkbox.
    const perm = await prisma.permission.findUnique({ where: { name: 'ACADEMY_CLINICAL_REVIEW' } });
    const ok = perm && await prisma.rolePermission.findFirst({ where: { permissionId: perm.id, role: { userRoles: { some: { userId: req.userId, active: true } } } } });
    if (!ok) throw httpError(403, 'Clinical-scope review requires ACADEMY_CLINICAL_REVIEW.');
  }
  const review = await prisma.articleReview.create({ data: { articleId: a.id, revisionId: rev.id, reviewerId: req.userId, decision, feedback: feedback || null, scope: scope || 'general' } });
  if (decision === 'approved') {
    // Freeze the approved revision — scheduling/publishing reference this
    // exact immutable revision.
    await prisma.knowledgeArticleRevision.update({ where: { id: rev.id }, data: { immutable: true } });
    await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { status: 'approved', approvedRevisionId: rev.id, reviewerId: req.userId, lastReviewedAt: new Date() } });
  } else {
    await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { status: 'changes_requested', reviewerId: req.userId } });
  }
  await audit.log({ actorId: req.userId, action: `article.review.${decision}`, entityType: 'KnowledgeArticle', entityId: a.id, afterData: { revisionId: rev.id, scope } });
  res.json({ review });
});

// ---------------------------------------------------------------------------
// SCHEDULING + PUBLISHING — validated at schedule time AND at publish time
// ---------------------------------------------------------------------------
async function validatePublishable(articleId) {
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: articleId } });
  if (!a) return { ok: false, reason: 'not_found' };
  if (!a.approvedRevisionId) return { ok: false, reason: 'no_approved_revision' };
  const approval = await prisma.articleReview.findFirst({ where: { articleId, revisionId: a.approvedRevisionId, decision: 'approved' } });
  if (!approval) return { ok: false, reason: 'approval_missing_for_revision' };
  const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.approvedRevisionId }, include: { evidence: { include: { source: true } } } });
  if (!rev?.immutable) return { ok: false, reason: 'revision_not_frozen' };
  if (!rev.evidence.length) return { ok: false, reason: 'no_references' };
  if (rev.evidence.some(e => e.source.status === 'retracted')) return { ok: false, reason: 'references_retracted_source' };
  const openCorr = await prisma.contentCorrection.count({ where: { articleId, status: 'open' } });
  if (openCorr) return { ok: false, reason: 'open_corrections' };
  return { ok: true, article: a, revision: rev };
}

router.post('/articles/:id/schedule', PUBLISH, async (req, res) => {
  const { publishKey, scheduledFor } = req.body || {};
  const when = new Date(scheduledFor);
  if (!publishKey || Number.isNaN(+when)) throw httpError(400, 'publishKey + valid scheduledFor required.');
  const v = await validatePublishable(req.params.id);
  if (!v.ok) throw httpError(409, `Not publishable: ${v.reason}`);
  const schedule = await prisma.editorialSchedule.upsert({
    where: { publishKey: String(publishKey) },
    update: { articleId: v.article.id, revisionId: v.article.approvedRevisionId, scheduledFor: when, status: 'scheduled', blockedReason: null },
    create: { publishKey: String(publishKey), articleId: v.article.id, revisionId: v.article.approvedRevisionId, scheduledFor: when, createdById: req.userId },
  });
  await prisma.knowledgeArticle.update({ where: { id: v.article.id }, data: { status: 'scheduled' } });
  await audit.log({ actorId: req.userId, action: 'article.schedule', entityType: 'EditorialSchedule', entityId: schedule.id, afterData: { publishKey, scheduledFor: when } });
  res.json({ schedule });
});

router.get('/calendar', PUBLISH, async (req, res) => {
  const rows = await prisma.editorialSchedule.findMany({
    where: { scheduledFor: { gte: new Date(Date.now() - 90 * 86400e3), lte: new Date(Date.now() + 90 * 86400e3) } },
    orderBy: { scheduledFor: 'asc' },
    include: { article: { select: { slug: true, status: true } }, revision: { select: { title: true } } },
  });
  res.json({ calendar: rows });
});

router.post('/schedule/:id/cancel', PUBLISH, async (req, res) => {
  const s = await prisma.editorialSchedule.update({ where: { id: req.params.id }, data: { status: 'cancelled' } });
  await audit.log({ actorId: req.userId, action: 'schedule.cancel', entityType: 'EditorialSchedule', entityId: s.id });
  res.json({ schedule: s });
});

// Emergency withdraw — published article is pulled, never silently edited.
router.post('/articles/:id/withdraw', PUBLISH, async (req, res) => {
  const a = await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: { status: 'retracted', withdrawnAt: new Date() } });
  await prisma.editorialSchedule.updateMany({ where: { articleId: a.id, status: 'scheduled' }, data: { status: 'withdrawn' } });
  await audit.log({ actorId: req.userId, action: 'article.withdraw', entityType: 'KnowledgeArticle', entityId: a.id });
  res.json({ status: 'retracted' });
});

// Corrections: a corrected version is a NEW revision that goes through review.
router.post('/articles/:id/corrections', PUBLISH, async (req, res) => {
  const { kind, detail } = req.body || {};
  const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } });
  if (!a) throw httpError(404, 'Not found.');
  const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.currentRevisionId || a.publishedRevisionId || '' } });
  const c = await prisma.contentCorrection.create({ data: { articleId: a.id, revisionId: rev.id, kind: kind || 'error', detail: String(detail || ''), createdById: req.userId } });
  if (a.status === 'published') await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { status: 'correction_required' } });
  res.status(201).json({ correction: c });
});

// ---------------------------------------------------------------------------
// REVIEWERS
// ---------------------------------------------------------------------------
router.get('/reviewers', MANAGE_REVIEWERS, async (req, res) => {
  const rows = await prisma.reviewerProfile.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ reviewers: rows });
});

router.put('/reviewers/:userId', MANAGE_REVIEWERS, async (req, res) => {
  const { expertise, qualifications, conflicts, clinical, active } = req.body || {};
  const p = await prisma.reviewerProfile.upsert({
    where: { userId: req.params.userId },
    update: { expertise, qualifications, conflicts, clinical, active },
    create: { userId: req.params.userId, expertise: expertise || [], qualifications, conflicts, clinical: Boolean(clinical) },
  });
  await audit.log({ actorId: req.userId, action: 'reviewer.upsert', entityType: 'ReviewerProfile', entityId: p.userId });
  res.json({ reviewer: p });
});

// ---------------------------------------------------------------------------
// FAQs — reuse ResearchSource keys; published only via editorial
// ---------------------------------------------------------------------------
router.get('/faqs', AUTHOR, async (req, res) => {
  res.json({ faqs: await prisma.knowledgeFAQ.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 }) });
});

router.post('/faqs', AUTHOR, async (req, res) => {
  const b = req.body || {};
  if (!b.canonicalQuestion || !b.shortAnswer) throw httpError(400, 'canonicalQuestion + shortAnswer required.');
  if (b.sourceKeys?.length) {
    const found = await prisma.researchSource.count({ where: { key: { in: b.sourceKeys } } });
    if (found !== b.sourceKeys.length) throw httpError(400, 'Unknown sourceKeys.');
  }
  const f = await prisma.knowledgeFAQ.create({ data: {
    canonicalQuestion: String(b.canonicalQuestion), aliases: b.aliases || [],
    shortAnswer: b.shortAnswer, detail: b.detail, topicTags: b.topicTags || [],
    articleId: b.articleId || null, sourceKeys: b.sourceKeys || [],
    certainty: b.certainty || 'NOT_ASSESSED', status: b.publish ? 'published' : 'draft',
    lastReviewedAt: b.publish ? new Date() : null, reviewerId: b.publish ? req.userId : null,
  } });
  res.status(201).json({ faq: f });
});

router.put('/faqs/:id', AUTHOR, async (req, res) => {
  const b = req.body || {};
  const data = { version: { increment: 1 } };
  for (const k of ['canonicalQuestion', 'shortAnswer', 'detail', 'aliases', 'topicTags', 'articleId', 'sourceKeys', 'certainty']) if (b[k] !== undefined) data[k] = b[k];
  if (b.status && ['draft', 'published', 'retired'].includes(b.status)) { data.status = b.status; if (b.status === 'published') { data.lastReviewedAt = new Date(); data.reviewerId = req.userId; } }
  const f = await prisma.knowledgeFAQ.update({ where: { id: req.params.id }, data });
  res.json({ faq: f });
});

router.get('/suggestions', AUTHOR, async (req, res) => {
  res.json({ suggestions: await prisma.knowledgeQuestionSuggestion.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) });
});

// ---------------------------------------------------------------------------
// SUPER ADMIN — panel stats + entitlements management
// ---------------------------------------------------------------------------
router.get('/panel/stats', PANEL, async (req, res) => {
  const day = 86400e3;
  const [users, activeSubs, pendingTrainers, pendingReviews, upcoming, failedPush, recentPriv] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * day) } } }),
    prisma.userEntitlement.count({ where: { status: 'active' } }),
    prisma.trainerProfile.count({ where: { verified: false } }).catch(() => 0),
    prisma.knowledgeArticle.count({ where: { status: 'ready_for_review' } }),
    prisma.editorialSchedule.findFirst({ where: { status: 'scheduled', scheduledFor: { gte: new Date() } }, orderBy: { scheduledFor: 'asc' }, include: { revision: { select: { title: true } } } }),
    prisma.notification.count({ where: { type: 'push_failed', createdAt: { gte: new Date(Date.now() - 7 * day) } } }).catch(() => 0),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { action: true, actorId: true, entityType: true, createdAt: true } }).catch(() => []),
  ]);
  res.json({ stats: { newUsers30d: users, activeEntitlements: activeSubs, pendingTrainers, pendingReviews, upcomingWeekly: upcoming, failedPushes7d: failedPush, recentPrivileged: recentPriv } });
});

router.get('/entitlements/modules', ENTITLEMENTS, async (req, res) => {
  const [modules, packages] = await Promise.all([
    prisma.membershipModule.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.membershipPackage.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  res.json({ modules, packages });
});

router.post('/entitlements/packages', ENTITLEMENTS, async (req, res) => {
  const b = req.body || {};
  if (!b.key || !b.name || !Array.isArray(b.modules)) throw httpError(400, 'key, name, modules[] required.');
  const valid = new Set((await prisma.membershipModule.findMany()).map(m => m.key));
  const bad = b.modules.filter(m => !valid.has(m));
  if (bad.length) throw httpError(400, `Unknown modules: ${bad.join(', ')}`);
  const pkg = await prisma.membershipPackage.upsert({
    where: { key: String(b.key) },
    update: { name: b.name, description: b.description, modules: b.modules, trialDays: b.trialDays || 0, platforms: b.platforms || [], displayCopy: b.displayCopy, effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : null, effectiveUntil: b.effectiveUntil ? new Date(b.effectiveUntil) : null },
    create: { key: String(b.key), name: b.name, description: b.description, modules: b.modules, trialDays: b.trialDays || 0, platforms: b.platforms || [], displayCopy: b.displayCopy, sortOrder: b.sortOrder || 0 },
  });
  await audit.log({ actorId: req.userId, action: 'package.upsert', entityType: 'MembershipPackage', entityId: pkg.id, afterData: { key: pkg.key, modules: b.modules } });
  res.json({ package: pkg });
});

router.post('/entitlements/packages/:key/activate', ENTITLEMENTS, async (req, res) => {
  const pkg = await prisma.membershipPackage.update({ where: { key: req.params.key }, data: { active: Boolean(req.body?.active) } });
  await audit.log({ actorId: req.userId, action: 'package.activate', entityType: 'MembershipPackage', entityId: pkg.id, afterData: { active: pkg.active } });
  res.json({ package: pkg });
});

// Admin grant/revoke — always audited, never fakes a payment.
router.post('/entitlements/grant', ENTITLEMENTS, async (req, res) => {
  const { userId, moduleKey, days, source } = req.body || {};
  if (!userId || !moduleKey) throw httpError(400, 'userId + moduleKey required.');
  const mod = await prisma.membershipModule.findUnique({ where: { key: moduleKey } });
  if (!mod) throw httpError(400, 'Unknown module.');
  const endsAt = days ? new Date(Date.now() + Number(days) * 86400e3) : null;
  const ent = await prisma.userEntitlement.create({ data: { userId, moduleKey, source: source || 'admin_grant', endsAt } });
  await prisma.entitlementEvent.create({ data: { userId, moduleKey, event: 'grant', occurredAt: new Date(), actorId: req.userId, payload: { days } } });
  await audit.log({ actorId: req.userId, action: 'entitlement.grant', entityType: 'UserEntitlement', entityId: ent.id, afterData: { userId, moduleKey, days } });
  res.status(201).json({ entitlement: ent });
});

router.post('/entitlements/revoke', ENTITLEMENTS, async (req, res) => {
  const { userId, moduleKey } = req.body || {};
  const ent = await prisma.userEntitlement.findFirst({ where: { userId, moduleKey, status: 'active' } });
  if (!ent) throw httpError(404, 'No active entitlement.');
  await prisma.userEntitlement.update({ where: { id: ent.id }, data: { status: 'revoked', endsAt: new Date() } });
  await prisma.entitlementEvent.create({ data: { userId, moduleKey, event: 'revoke', occurredAt: new Date(), actorId: req.userId } });
  await audit.log({ actorId: req.userId, action: 'entitlement.revoke', entityType: 'UserEntitlement', entityId: ent.id, afterData: { userId, moduleKey } });
  res.json({ revoked: true });
});

router.get('/entitlements/events', ENTITLEMENTS, async (req, res) => {
  res.json({ events: await prisma.entitlementEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: 100 }) });
});

// Member-visible: what modules do I hold?
router.get('/me/entitlements', async (req, res) => {
  if (!req.userId) throw httpError(401, 'Sign in required.');
  const { activeModules } = require('../lib/entitlements');
  const { modules, rows } = await activeModules(req.userId);
  res.json({ modules: [...modules], entitlements: rows });
});

module.exports = { router, validatePublishable };

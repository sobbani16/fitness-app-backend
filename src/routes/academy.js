// Member-facing Knowledge Academy — read-only public surfaces plus per-user
// saved items and question suggestions. Only PUBLISHED content is reachable:
// drafts/revisions-in-review never appear in lists, search, or detail routes.
const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const audit = require('../services/auditService');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');

const router = require('../lib/asyncRouter')();
const prisma = getPrisma();

const PUBLISHED = { publishedRevisionId: { not: null }, status: { notIn: ['retracted', 'archived'] } };
const VERDICTS = ['MYTH', 'MOSTLY_MYTH', 'CONTEXT_DEPENDENT', 'MOSTLY_SUPPORTED', 'SUPPORTED', 'INSUFFICIENT_EVIDENCE'];
const CATEGORIES = [
  'weight_loss', 'fat_loss', 'muscle_building', 'strength_training', 'cardio', 'nutrition',
  'protein', 'carbohydrates', 'dietary_fat', 'fiber', 'hydration', 'supplements', 'creatine',
  'whey_protein', 'vitamins_minerals', 'sleep', 'recovery', 'mobility_flexibility',
  'womens_fitness', 'aging_fitness', 'beginners', 'exercise_technique', 'fitness_technology',
  'wearables_calories', 'food_labels', 'indian_diet', 'food_safety',
];

const revisionShape = rev => rev && ({
  title: rev.title, claim: rev.claim, verdict: rev.verdict, shortVerdict: rev.shortVerdict,
  explanation: rev.explanation, takeaway: rev.takeaway, appliesTo: rev.appliesTo,
  exceptions: rev.exceptions, uncertainty: rev.uncertainty, certainty: rev.certainty,
  version: rev.version,
});

const publicArticle = async (article) => {
  const rev = await prisma.knowledgeArticleRevision.findUnique({
    where: { id: article.publishedRevisionId || '' },
    include: { evidence: { include: { source: true }, orderBy: { position: 'asc' } } },
  });
  if (!rev) return null;
  return {
    id: article.id, slug: article.slug, category: article.category, tags: article.tags,
    publishedAt: article.publishedAt, lastReviewedAt: article.lastReviewedAt,
    revision: revisionShape(rev),
    sources: rev.evidence.map(e => ({
      key: e.source.key, title: e.source.title, authors: e.source.authors, journal: e.source.journal,
      year: e.source.year, doi: e.source.doi, pmid: e.source.pmid, url: e.source.url,
      studyType: e.source.studyType, status: e.source.status, supports: e.supports,
    })),
  };
};

router.use(identifyUser);

// GET /academy/topics — categories + counts
router.get('/topics', async (req, res) => {
  const counts = await prisma.knowledgeArticle.groupBy({ by: ['category'], where: PUBLISHED, _count: true });
  const map = Object.fromEntries(counts.map(c => [c.category, c._count]));
  res.json({ topics: CATEGORIES.map(c => ({ key: c, label: c.replace(/_/g, ' '), articles: map[c] || 0 })) });
});

// GET /academy/featured — newest published weekly edition
router.get('/featured', async (req, res) => {
  const ev = await prisma.publicationEvent.findFirst({
    where: { kind: 'weekly' }, orderBy: { publishedAt: 'desc' },
    include: { revision: { include: { article: true } } },
  });
  const article = ev ? await prisma.knowledgeArticle.findFirst({ where: { id: ev.articleId, ...PUBLISHED } }) : null;
  res.json({ featured: article ? await publicArticle(article) : null });
});

// GET /academy/articles — archive list (published only), filter+search+sort
router.get('/articles', async (req, res) => {
  const { category, q, sort = 'newest' } = req.query;
  const take = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor ? { id: String(req.query.cursor) } : undefined;
  const where = {
    ...PUBLISHED,
    ...(category ? { category: String(category) } : {}),
    ...(q ? {
      OR: [
        { slug: { contains: String(q), mode: 'insensitive' } },
        { revisions: { some: { version: { gt: 0 }, OR: [
          { title: { contains: String(q), mode: 'insensitive' } },
          { claim: { contains: String(q), mode: 'insensitive' } },
          { shortVerdict: { contains: String(q), mode: 'insensitive' } },
        ] } } },
      ],
    } : {}),
  };
  const rows = await prisma.knowledgeArticle.findMany({
    where, take: take + 1, ...(cursor ? { cursor, skip: 1 } : {}),
    orderBy: sort === 'oldest' ? { publishedAt: 'asc' } : { publishedAt: 'desc' },
  });
  const page = rows.slice(0, take);
  const items = (await Promise.all(page.map(async a => {
    const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.publishedRevisionId || '' } });
    return rev ? { id: a.id, slug: a.slug, category: a.category, tags: a.tags, publishedAt: a.publishedAt,
      title: rev.title, claim: rev.claim, verdict: rev.verdict, shortVerdict: rev.shortVerdict, certainty: rev.certainty } : null;
  }))).filter(Boolean);
  res.json({ articles: items, nextCursor: rows.length > take ? page[page.length - 1].id : null });
});

// GET /academy/articles/:slug — full published article with evidence
router.get('/articles/:slug', async (req, res) => {
  const a = await prisma.knowledgeArticle.findFirst({ where: { slug: req.params.slug, ...PUBLISHED } });
  if (!a) throw httpError(404, 'Article not found.');
  const [full, prev, next, faqs] = await Promise.all([
    publicArticle(a),
    prisma.knowledgeArticle.findFirst({ where: { ...PUBLISHED, publishedAt: { lt: a.publishedAt } }, orderBy: { publishedAt: 'desc' }, select: { slug: true } }),
    prisma.knowledgeArticle.findFirst({ where: { ...PUBLISHED, publishedAt: { gt: a.publishedAt } }, orderBy: { publishedAt: 'asc' }, select: { slug: true } }),
    prisma.knowledgeFAQ.findMany({ where: { articleId: a.id, status: 'published' }, select: { id: true, canonicalQuestion: true, shortAnswer: true } }),
  ]);
  res.json({ article: { ...full, prevSlug: prev?.slug || null, nextSlug: next?.slug || null, relatedFaqs: faqs } });
});

// Saved articles — member only (identifyUser ran already; require a session)
const requireAuth = (req, res, next) => { if (!req.userId) return next(httpError(401, 'Sign in required.')); next(); };

router.post('/articles/:id/save', requireAuth, async (req, res) => {
  const a = await prisma.knowledgeArticle.findFirst({ where: { id: req.params.id, ...PUBLISHED } });
  if (!a) throw httpError(404, 'Article not found.');
  await prisma.knowledgeSavedItem.upsert({ where: { userId_articleId: { userId: req.userId, articleId: a.id } }, update: {}, create: { userId: req.userId, articleId: a.id } });
  res.status(201).json({ saved: true });
});
router.delete('/articles/:id/save', requireAuth, async (req, res) => {
  await prisma.knowledgeSavedItem.deleteMany({ where: { userId: req.userId, articleId: req.params.id } });
  res.json({ saved: false });
});
router.get('/saved', requireAuth, async (req, res) => {
  const items = await prisma.knowledgeSavedItem.findMany({
    where: { userId: req.userId, article: PUBLISHED }, orderBy: { createdAt: 'desc' },
    include: { article: { select: { id: true, slug: true, category: true, publishedAt: true, publishedRevisionId: true } } },
  });
  const out = [];
  for (const it of items) {
    const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: it.article.publishedRevisionId || '' } });
    if (rev) out.push({ id: it.article.id, slug: it.article.slug, category: it.article.category, title: rev.title, verdict: rev.verdict, savedAt: it.createdAt });
  }
  res.json({ saved: out });
});

// GET /academy/faq/search — FAQs first, then articles. No fabrication: empty
// result means "no reviewed answer", the client shows the honest gap state.
router.get('/faq/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ faqs: [], articles: [] });
  const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const faqs = await prisma.knowledgeFAQ.findMany({
    where: { status: 'published', OR: [
      { canonicalQuestion: { contains: q, mode: 'insensitive' } },
      { shortAnswer: { contains: q, mode: 'insensitive' } },
      { detail: { contains: q, mode: 'insensitive' } },
      ...words.map(w => ({ canonicalQuestion: { contains: w, mode: 'insensitive' } })),
    ] },
    take: 10,
    select: { id: true, canonicalQuestion: true, shortAnswer: true, certainty: true, lastReviewedAt: true, articleId: true, topicTags: true },
  });
  const articleHits = await prisma.knowledgeArticle.findMany({
    where: { ...PUBLISHED, revisions: { some: { OR: [
      { title: { contains: q, mode: 'insensitive' } }, { claim: { contains: q, mode: 'insensitive' } },
      { shortVerdict: { contains: q, mode: 'insensitive' } },
    ] } } },
    take: 8, select: { id: true, slug: true, category: true, publishedRevisionId: true },
  });
  const articles = [];
  for (const a of articleHits) {
    const rev = await prisma.knowledgeArticleRevision.findUnique({ where: { id: a.publishedRevisionId || '' } });
    if (rev) articles.push({ slug: a.slug, title: rev.title, verdict: rev.verdict, shortVerdict: rev.shortVerdict, certainty: rev.certainty });
  }
  res.json({ faqs, articles });
});

router.get('/faq', async (req, res) => {
  const faqs = await prisma.knowledgeFAQ.findMany({ where: { status: 'published' }, orderBy: { canonicalQuestion: 'asc' }, take: 100,
    select: { id: true, canonicalQuestion: true, shortAnswer: true, topicTags: true, lastReviewedAt: true } });
  res.json({ faqs });
});

router.get('/faq/:id', async (req, res) => {
  const f = await prisma.knowledgeFAQ.findFirst({ where: { id: req.params.id, status: 'published' } });
  if (!f) throw httpError(404, 'Question not found.');
  const sources = await prisma.researchSource.findMany({ where: { key: { in: f.sourceKeys || [] } } });
  res.json({ faq: { ...f, sourceKeys: undefined }, sources: sources.map(s => ({ key: s.key, title: s.title, journal: s.journal, year: s.year, url: s.url, doi: s.doi, pmid: s.pmid, status: s.status })) });
});

// POST /academy/suggestions — member proposes a question for review
router.post('/suggestions', requireAuth, async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (question.length < 8 || question.length > 400) throw httpError(400, 'Question must be 8–400 characters.');
  await prisma.knowledgeQuestionSuggestion.create({ data: { userId: req.userId, question } });
  res.status(201).json({ suggested: true });
});

// Coaching preference — Trainer Partnership Mode. Member declares their
// coaching model; AI features must honor it (no silent trainer replacement).
const COACHING_MODELS = ['self_guided', 'humai_assisted', 'trainer_led', 'hybrid'];
router.get('/coaching-preference', requireAuth, async (req, res) => {
  const p = await prisma.coachingPreference.findUnique({ where: { userId: req.userId } });
  res.json({ model: p?.model || 'self_guided', options: COACHING_MODELS });
});
router.put('/coaching-preference', requireAuth, async (req, res) => {
  const model = String(req.body?.model || '');
  if (!COACHING_MODELS.includes(model)) throw httpError(400, `model must be one of: ${COACHING_MODELS.join(', ')}`);
  const p = await prisma.coachingPreference.upsert({ where: { userId: req.userId }, update: { model }, create: { userId: req.userId, model } });
  res.json({ model: p.model });
});

module.exports = { router, VERDICTS, CATEGORIES };

const express = require('express');
const { opportunities, streak } = require('../services/progressCoach');
const { requireFeature } = require('../middleware/requireFeature');
const { isValidZone } = require('../services/localDay');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();
const wrap = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };
const uid = (req) => req.userId; // authenticated identity only — never client-supplied

// GET /progress-coach/opportunities?tz= — today's ranked, point-projected actions
router.get('/opportunities', requireFeature('progress_opportunities_enabled'), wrap(async (req) => ({
  ...(await opportunities(uid(req), { tz: isValidZone(req.query.tz) ? req.query.tz : undefined })),
})));

// GET /progress-coach/streak — consistency streak + qualification rule
router.get('/streak', requireFeature('consistency_streak_enabled'), wrap(async (req) => ({
  streak: await streak(uid(req), { tz: isValidZone(req.query.tz) ? req.query.tz : undefined }),
})));

// PUT /progress-coach/streak/pause { minutes?, until?, dayKeys? } — user-controlled pause
router.put('/streak/pause', requireFeature('consistency_streak_enabled'), wrap(async (req) => {
  const { until, dayKeys } = req.body || {};
  const data = {};
  if (until !== undefined) data.pausedUntil = until ? new Date(until) : null;
  if (Array.isArray(dayKeys)) data.pauseDays = dayKeys.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 60);
  const prefs = await getPrisma().userStreakPreferences.upsert({ where: { userId: uid(req) }, create: { userId: uid(req), ...data }, update: data });
  return { preferences: prefs };
}));

// GET /progress-coach/ask?q= — deterministic Leo answers over real data (M13)
router.get('/ask', requireFeature('leo_progress_coach_enabled'), wrap(async (req) => {
  const q = String(req.query.q || '').toLowerCase();
  const tz = isValidZone(req.query.tz) ? req.query.tz : undefined;
  const [opps, s] = await Promise.all([opportunities(uid(req), { tz }), streak(uid(req), { tz })]);
  const top = opps.top[0];
  let answer;
  if (/streak/.test(q)) answer = s.todayQualified ? 'Today\u2019s consistency goal is already met.' : `You're ${s.current ? 'on a ' + s.current + '-day run. ' : ''}${top ? `Finishing “${top.title}” could qualify today.` : 'Complete any planned goal to qualify today.'}`;
  else if (/rest/.test(q)) answer = 'Yes — a planned rest day counts toward your consistency when you follow your recovery plan.';
  else if (/didn.t|why.*(increase|change)/.test(q)) answer = 'Your score only moves when a verified record lands — a logged meal, water, finished workout or habit. Logging alone without records doesn\u2019t award points.';
  else answer = top ? `${top.title} — up to +${top.projectedPoints} progress points. ${top.explanation}` : 'Everything applicable today is already done — nice work.';
  return { answer, opportunities: opps.top, streak: { current: s.current, todayQualified: s.todayQualified }, version: opps.version };
}));

module.exports = router;

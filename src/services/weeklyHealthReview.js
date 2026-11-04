// Weekly personal health review v1 — generated on demand for the member's
// own week (Mon–Sun). Separate from the plan-scoped WeeklyReview and the
// public Myth vs Fact publication.
//
// Everything in the review is observed or explicitly reported as absent —
// progress is only claimed when records support it, and missed days are
// surfaced as "not logged", never as failure. Recommendations are capped
// (opportunities ≤ 2, one focus) per spec. No health details belong in
// notification text — the review is pull-based in v1.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { getSleepRecoverySummary } = require('./sleepRecovery');
const q = async (p) => { try { return await p; } catch { return null; } };

const REVIEW_KEY = 'weekly_review';
const DAY_MS = 86400000;
const OPT_PATH = 'weeklyReview';

function todayStr(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const toStr = (d) => d.toISOString().slice(0, 10);

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

// Review window: default = the current week so far (in the member's tz);
// ?weekOf=YYYY-MM-DD reviews the Mon–Sun containing that date.
async function composeReview(userId, { tz = 'UTC', weekOf = null } = {}) {
  const prisma = getPrisma();
  const today = todayStr(tz);
  const monday = mondayOf(weekOf || today);
  const weekStart = toStr(monday);
  const dayList = [];
  for (let i = 0; i < 7; i++) { const d = new Date(monday.getTime() + i * DAY_MS); dayList.push(toStr(d)); }
  const daysElapsed = Math.min(7, Math.max(0, Math.floor((new Date(`${today}T00:00:00Z`) - monday) / DAY_MS) + 1));
  const complete = weekStart < toStr(mondayOf(today));
  const end = new Date(monday.getTime() + 7 * DAY_MS);

  const [user, foodLogs, sessions, sleep, habits, wellness, relation] = await Promise.all([
    q(prisma.user.findUnique({ where: { id: userId }, select: { goalType: true } })),
    q(prisma.foodLog.groupBy({ by: ['date'], where: { userId, date: { in: dayList } } })),
    q(prisma.workoutSession.findMany({ where: { userId, startedAt: { gte: monday, lt: end } }, select: { finishedAt: true } })),
    q(getSleepRecoverySummary(userId, { tz })),
    q(prisma.habitCompletion.findMany({ where: { habit: { userId }, day: { in: dayList } }, select: { outcome: true } })),
    q(prisma.wellnessCheckIn.findMany({ where: { userId, loggedAt: { gte: monday, lt: end } }, select: { stress: true } })),
    q(prisma.trainerClient.findFirst({
      where: { clientId: userId, status: 'active' },
      include: { trainer: { select: { displayName: true } } },
    })),
  ]);
  const rel = relation || null;
  const [checkInRow, activePlan, published] = await Promise.all([
    rel ? q(prisma.checkIn.findUnique({ where: { relationId_weekOf: { relationId: rel.id, weekOf: monday } } })) : null,
    rel ? q(prisma.outcomePlan.findFirst({ where: { relationId: rel.id, status: 'active' }, include: { goals: true } })) : null,
    q(prisma.knowledgeArticle.findMany({
      where: { status: 'published' }, orderBy: { publishedAt: 'desc' }, take: 2,
      select: { slug: true, category: true, publishedRevisionId: true },
    })),
  ]);
  const revIds = (published || []).map((a) => a.publishedRevisionId).filter(Boolean);
  const revs = revIds.length ? (await q(prisma.knowledgeArticleRevision.findMany({ where: { id: { in: revIds } }, select: { id: true, title: true } }))) || [] : [];
  const revTitle = Object.fromEntries(revs.map((r) => [r.id, r.title]));

  // ---- evidence assembly ----------------------------------------------
  const mealsLoggedDays = new Set((foodLogs || []).map((l) => l.date)).size;
  const sessionsPlanned = (sessions || []).length;
  const workoutsDone = (sessions || []).filter((s) => s.finishedAt).length;
  const habitsDone = (habits || []).filter((h) => h.outcome === 'done').length;
  const habitsSkipped = (habits || []).filter((h) => h.outcome === 'skipped').length;
  const sleepNights = sleep?.nights || 0;
  const avgSleep = sleep?.avgHours ?? null;
  const wellnessLogged = (wellness || []).length;
  const avgStress = wellnessLogged ? wellness.reduce((s, w) => s + (w.stress || 0), 0) / wellnessLogged : null;
  const checkInSent = !!checkInRow;
  const checkInDifficulty = checkInRow?.workoutDifficulty ?? null;
  const checkInEnergy = checkInRow?.energyLevel ?? null;
  const goals = activePlan ? activePlan.goals : [];
  const goalsOpen = goals.filter((g) => g.status === 'open').length;
  const goalsMet = goals.filter((g) => g.status === 'met').length;

  const evidence = {
    mealsLoggedDays: mealsLoggedDays || null,
    workoutsDone: sessionsPlanned ? workoutsDone : null,
    sessionsPlanned: sessionsPlanned || null,
    sleepNights: sleepNights || null,
    avgSleepHours: avgSleep,
    habitsDone: habitsDone || null,
    habitsSkipped: habitsSkipped || null,
    wellnessCheckIns: wellnessLogged || null,
    avgStress: avgStress == null ? null : +avgStress.toFixed(1),
    checkInSent: rel ? checkInSent : null,
    checkInDifficulty, checkInEnergy,
    goalsOpen: activePlan ? goalsOpen : null,
    goalsMet: activePlan ? goalsMet : null,
  };
  const observed = Object.values(evidence).filter((v) => v != null && v !== false).length;
  const completeness = observed >= 6 ? 'good' : observed >= 3 ? 'partial' : 'sparse';

  const wentWell = [];
  if (mealsLoggedDays >= 5) wentWell.push({ text: `You logged meals on ${mealsLoggedDays} of 7 days.`, evidence: 'meal logging' });
  else if (mealsLoggedDays >= 3) wentWell.push({ text: `You logged meals on ${mealsLoggedDays} days this week.`, evidence: 'meal logging' });
  if (workoutsDone >= 3) wentWell.push({ text: `You completed ${workoutsDone} workouts.`, evidence: 'workout sessions' });
  else if (workoutsDone > 0) wentWell.push({ text: `You completed ${workoutsDone} workout${workoutsDone > 1 ? 's' : ''}.`, evidence: 'workout sessions' });
  if (habitsDone >= 3) wentWell.push({ text: `You completed ${habitsDone} habit check-ins.`, evidence: 'habits' });
  if (avgSleep != null && avgSleep >= 7 && sleepNights >= 3) wentWell.push({ text: `Sleep averaged ${avgSleep}h across ${sleepNights} nights.`, evidence: 'sleep' });
  if (checkInSent) wentWell.push({ text: 'You sent your weekly check-in to your coach.', evidence: 'check-in' });
  if (wellnessLogged >= 4) wentWell.push({ text: `You logged how you felt on ${wellnessLogged} days.`, evidence: 'wellness' });
  if (goalsMet > 0) wentWell.push({ text: `${goalsMet} goal${goalsMet > 1 ? 's' : ''} marked met on your outcome plan.`, evidence: 'outcome plan' });

  const wasDifficult = [];
  if (avgSleep != null && avgSleep < 6 && sleepNights >= 3) wasDifficult.push({ text: `Sleep averaged ${avgSleep}h — under 6 hours across ${sleepNights} logged nights.`, evidence: 'sleep' });
  if (avgStress != null && avgStress >= 4 && wellnessLogged >= 2) wasDifficult.push({ text: `Average reported stress was ${avgStress.toFixed(1)}/5 across ${wellnessLogged} check-ins.`, evidence: 'wellness' });
  if (checkInDifficulty != null && checkInDifficulty >= 4) wasDifficult.push({ text: `You rated workout difficulty ${checkInDifficulty}/5 in your check-in.`, evidence: 'check-in' });
  if (checkInEnergy != null && checkInEnergy <= 2) wasDifficult.push({ text: `You reported energy ${checkInEnergy}/5 in your check-in.`, evidence: 'check-in' });

  const opportunities = [];
  if (sleepNights >= 3 && avgSleep != null && avgSleep < 7) opportunities.push({ text: 'A consistent wake time is one of the most reliable levers for better sleep.', evidence: 'sleep below 7h average' });
  if (rel && !checkInSent) opportunities.push({ text: 'Your coach can only adjust things they know about — a short weekly check-in goes a long way.', evidence: 'check-in not sent' });
  if (daysElapsed >= 4 && mealsLoggedDays === 0) opportunities.push({ text: 'Even one logged meal a day gives you (and your coach) something real to work with.', evidence: 'no meal logs' });
  if (sessionsPlanned === 0) opportunities.push({ text: 'No workouts were on record this week — even a short planned session builds the pattern.', evidence: 'no workout sessions' });
  if (habitsDone === 0 && habitsSkipped === 0) opportunities.push({ text: 'Picking one tiny habit to track is an easy way to build momentum.', evidence: 'no habits tracked' });
  if (rel && !activePlan) opportunities.push({ text: 'You don\'t have a shared outcome plan yet — your coach can set one up with you.', evidence: 'no outcome plan' });
  const topOpportunities = opportunities.slice(0, 2);
  const nextWeekFocus = topOpportunities[0]?.text || (wentWell.length
    ? 'Keep the current rhythm going — consistency matters more than intensity.'
    : 'Start small: one workout, one logged meal, one night of decent sleep.');

  const summary = completeness === 'sparse'
    ? 'A lighter tracking week — here\'s what the available data shows, plus one simple next step.'
    : `${wentWell.length} thing${wentWell.length === 1 ? '' : 's'} went well${wasDifficult.length ? `, and ${wasDifficult.length} area${wasDifficult.length === 1 ? '' : 's'} looked harder` : ''}. One focus for next week is below.`;

  return {
    weekOf: weekStart, daysElapsed, complete, timezone: tz,
    goalType: user?.goalType || null,
    summary, wentWell, wasDifficult,
    opportunities: topOpportunities, nextWeekFocus,
    progress: evidence, dataCompleteness: completeness,
    trainer: rel ? {
      present: true, displayName: rel.trainer?.displayName || null,
      checkInStatus: checkInSent ? (checkInRow.reviewedAt ? 'reviewed' : 'submitted') : 'not_submitted',
      trainerReply: checkInRow?.reviewedAt ? (checkInRow.trainerReply || null) : null,
    } : { present: false },
    relatedContent: (published || []).map((a) => ({ slug: a.slug, category: a.category, title: revTitle[a.publishedRevisionId] || a.slug })),
    note: 'Optional weekly review — progress is only claimed when records support it; gaps are noted, never scored as failure. No health details appear in notification text.',
  };
}

function userOpt(user) {
  const stored = user?.profileData?.[OPT_PATH];
  return { enabled: stored?.enabled !== false };
}

async function getReview(userId, opts = {}) {
  const prisma = getPrisma();
  const user = await q(prisma.user.findUnique({ where: { id: userId }, select: { profileData: true } }));
  const monday = mondayOf(opts.weekOf || todayStr(opts.tz || 'UTC'));
  const data = await composeReview(userId, opts);
  const row = await prisma.weeklyHealthReview.upsert({
    where: { userId_weekOf: { userId, weekOf: monday } },
    create: { userId, weekOf: monday, data },
    update: { data },
    select: { id: true, weekOf: true, openedAt: true, createdAt: true },
  });
  return { ...row, weekOf: toStr(row.weekOf), enabled: userOpt(user).enabled, ...data };
}

async function setOpt(userId, { enabled }) {
  if (typeof enabled !== 'boolean') throw httpError(400, 'enabled must be a boolean');
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, profileData: true } });
  if (!user) throw httpError(404, 'User not found');
  const profileData = { ...(user.profileData || {}) };
  profileData[OPT_PATH] = { enabled, updatedAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: userId }, data: { profileData } });
  return { enabled };
}

async function markOpened(userId, weekOfStr) {
  const prisma = getPrisma();
  const monday = mondayOf(weekOfStr);
  const row = await prisma.weeklyHealthReview.findUnique({ where: { userId_weekOf: { userId, weekOf: monday } } });
  if (!row) throw httpError(404, 'Weekly review not found — request it first');
  if (!row.openedAt) await prisma.weeklyHealthReview.update({ where: { id: row.id }, data: { openedAt: new Date() } });
  return { opened: true, weekOf: toStr(monday) };
}

async function listHistory(userId) {
  const prisma = getPrisma();
  const rows = await prisma.weeklyHealthReview.findMany({
    where: { userId }, orderBy: { weekOf: 'desc' }, take: 12,
    select: { weekOf: true, openedAt: true, createdAt: true },
  });
  return { weeks: rows.map((r) => ({ ...r, weekOf: toStr(r.weekOf) })) };
}

module.exports = { getReview, composeReview, setOpt, markOpened, listHistory, REVIEW_KEY };

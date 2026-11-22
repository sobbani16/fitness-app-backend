// Trainer Copilot v1 — read-only client summaries + rule-based draft
// suggestions. Every suggestion is labeled "AI draft — requires trainer
// confirmation"; nothing here writes to plans or messages, and nothing is
// fabricated — a suggestion only exists when its evidence exists. Consent-
// gated categories are omitted entirely and reported as "not shared".
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireApprovedTrainer, getGrantedCategories } = require('./trainerAccess');
const { loadDisplayNames } = require('./trainerService');

const DRAFT_LABEL = 'AI draft — requires trainer confirmation';
const DAY = 86400000;

function mondayUTC(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

const safe = (p, fallback = null) => Promise.resolve().then(p).catch(() => fallback);

async function requireRelation(trainerUserId, clientId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const relation = await getPrisma().trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: trainer.id, clientId } },
    include: { trainer: { select: { userId: true, displayName: true } } },
  });
  if (!relation || relation.status !== 'active') throw httpError(403, 'No active coaching relationship.');
  return { trainer, relation };
}

// One-line status per active client for the copilot landing view.
async function listClients(trainerUserId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const prisma = getPrisma();
  const relations = await prisma.trainerClient.findMany({
    where: { trainerId: trainer.id, status: 'active' }, orderBy: { startedAt: 'desc' }, take: 100,
  });
  if (!relations.length) return { version: 'copilot-v1', clients: [] };
  const monday = mondayUTC();
  const names = await loadDisplayNames(relations.map(r => r.clientId));
  const [checkIns, intakes, plans, formChecks] = await Promise.all([
    safe(() => prisma.checkIn.findMany({ where: { relationId: { in: relations.map(r => r.id) }, weekOf: monday }, select: { relationId: true, reviewedAt: true } }), []),
    safe(() => prisma.baselineAssessment.findMany({ where: { relationId: { in: relations.map(r => r.id) } }, orderBy: { version: 'desc' }, select: { relationId: true, status: true } }), []),
    safe(() => prisma.outcomePlan.findMany({ where: { relationId: { in: relations.map(r => r.id) }, status: 'active' }, select: { relationId: true, id: true } }), []),
    safe(() => prisma.formCheckRequest.findMany({ where: { relationId: { in: relations.map(r => r.id) }, status: 'submitted' }, select: { relationId: true, id: true } }), []),
  ]);
  const latestIntake = {};
  for (const a of intakes) if (!latestIntake[a.relationId]) latestIntake[a.relationId] = a.status;
  return {
    version: 'copilot-v1',
    clients: relations.map(r => {
      const ci = checkIns.find(c => c.relationId === r.id);
      return {
        relationId: r.id,
        clientId: r.clientId,
        clientName: names.get(r.clientId) || 'Client',
        since: r.startedAt,
        checkInThisWeek: ci ? (ci.reviewedAt ? 'reviewed' : 'awaiting_review') : 'missing',
        intakeStatus: latestIntake[r.relationId] || 'none',
        hasOutcomePlan: plans.some(p => p.relationId === r.id),
        pendingFormChecks: formChecks.filter(f => f.relationId === r.id).length,
      };
    }),
  };
}

// Consent-scoped summary — only what the member granted + member-authored
// check-ins (which are disclosures sent to the coach). Counts and recency
// only; raw logs stay in the consent-gated progress endpoint.
async function clientSummary(trainerUserId, clientId) {
  const { relation } = await requireRelation(trainerUserId, clientId);
  const prisma = getPrisma();
  const granted = await getGrantedCategories(relation.id);
  const has = c => granted.has(c);
  const since7 = new Date(Date.now() - 7 * DAY);
  const since28 = new Date(Date.now() - 28 * DAY);
  const monday = mondayUTC();

  const [checkIns, intake, plan, formChecks, workouts, sleep, steps, weights] = await Promise.all([
    safe(() => prisma.checkIn.findMany({ where: { relationId: relation.id }, orderBy: { weekOf: 'desc' }, take: 4 }), []),
    safe(() => prisma.baselineAssessment.findFirst({ where: { relationId: relation.id }, orderBy: { version: 'desc' } })),
    safe(() => prisma.outcomePlan.findFirst({ where: { relationId: relation.id, status: 'active' }, include: { goals: true } })),
    safe(() => prisma.formCheckRequest.findMany({ where: { relationId: relation.id }, orderBy: { createdAt: 'desc' }, take: 10, include: { feedback: true } }), []),
    has('workout_records') ? safe(() => prisma.workoutSession.findMany({ where: { userId: clientId, startedAt: { gte: since28 } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, finishedAt: true } }), []) : null,
    has('sleep_summaries') ? safe(() => prisma.sleepLog.findMany({ where: { userId: clientId, sleepStart: { gte: since7 } }, select: { hoursSlept: true, sleepStart: true, sleepEnd: true } }), []) : null,
    has('step_counts') ? safe(() => prisma.dailySteps.findMany({ where: { userId: clientId, date: { gte: since7 } }, select: { steps: true, date: true } }), []) : null,
    has('weight_trends') ? safe(() => prisma.weightEntry.findMany({ where: { userId: clientId }, orderBy: { recordedAt: 'desc' }, take: 2 }), []) : null,
  ]);

  const names = await loadDisplayNames([clientId]);
  const workouts7 = (workouts || []).filter(w => new Date(w.startedAt) >= since7);
  const sleepHours = (sleep || []).map(l => l.hoursSlept ?? ((new Date(l.sleepEnd) - new Date(l.sleepStart)) / 3600000)).filter(h => h > 0 && h < 18);

  return {
    version: 'copilot-v1',
    generatedAt: new Date().toISOString(),
    relation: { id: relation.id, since: relation.startedAt, status: relation.status },
    client: { id: clientId, name: names.get(clientId) || 'Client' },
    consent: {
      granted: [...granted],
      notShared: ['workout_records', 'food_logs', 'nutrition_summaries', 'weight_trends', 'sleep_summaries', 'step_counts', 'body_measurements', 'health_scores'].filter(c => !granted.has(c)),
    },
    intake: intake ? { status: intake.status, version: intake.version, updatedAt: intake.updatedAt } : { status: 'none' },
    outcomePlan: plan ? {
      id: plan.id, version: plan.version, note: plan.note,
      goals: plan.goals.map(g => ({ id: g.id, kind: g.kind, title: g.title, status: g.status, target: g.target, targetDate: g.targetDate, reviewIntervalDays: g.reviewIntervalDays, progressSource: g.progressSource })),
    } : null,
    checkIns: {
      thisWeek: checkIns.find(c => new Date(c.weekOf).getTime() === monday.getTime()) ? 'submitted' : 'missing',
      recent: checkIns.map(c => ({
        id: c.id, weekOf: c.weekOf, energyLevel: c.energyLevel, workoutDifficulty: c.workoutDifficulty,
        hasQuestions: Boolean(c.questions), hasChallenges: Boolean(c.challenges),
        questions: c.questions, challenges: c.challenges, reviewed: Boolean(c.reviewedAt),
      })),
    },
    formChecks: formChecks.map(f => ({ id: f.id, exerciseName: f.exerciseName, status: f.status, submittedAt: f.submittedAt, feedbackCount: f.feedback.length })),
    activity: {
      workoutsLast7d: workouts ? workouts7.length : null,
      workoutsLast28d: workouts ? workouts.length : null,
      lastWorkoutAt: workouts?.[0]?.startedAt ?? null,
      avgSleepHours7d: sleep ? (sleepHours.length ? Number((sleepHours.reduce((s, h) => s + h, 0) / sleepHours.length).toFixed(1)) : null) : null,
      nightsLogged7d: sleep ? sleepHours.length : null,
      avgSteps7d: steps?.length ? Math.round(steps.reduce((s, r) => s + (r.steps || 0), 0) / steps.length) : null,
      latestWeightKg: weights?.[0]?.weightKg ?? null,
      weightTrend: weights?.length === 2 ? Math.sign(weights[0].weightKg - weights[1].weightKg) : null,
    },
    note: 'Read-only summary assembled from member-consented data. "notShared" categories are hidden, not absent — ask the member before assuming.',
  };
}

// Rule-based drafts. Each rule only fires when its evidence exists; every
// suggestion requires trainer confirmation before anything is applied.
async function clientSuggestions(trainerUserId, clientId) {
  const { relation } = await requireRelation(trainerUserId, clientId);
  const s = await clientSummary(trainerUserId, clientId);
  const out = [];
  const add = (kind, title, detail, evidence, confidence = 'partial') =>
    out.push({ kind, title, detail, evidence, confidence, generatedBy: 'humai_copilot', label: DRAFT_LABEL, requiresTrainerConfirmation: true });

  const latestCheckIn = s.checkIns.recent[0];
  if (s.checkIns.thisWeek === 'missing') {
    add('checkin_overdue', 'Check-in missing for this week',
      'Consider a short reminder — one missing week is common, not a compliance verdict.',
      ['No check-in for the current week'], 'partial');
  }
  if (latestCheckIn && !latestCheckIn.reviewed) {
    add('checkin_review', 'Review the latest check-in',
      'The member submitted a check-in that is awaiting your review.',
      [`Check-in week of ${new Date(latestCheckIn.weekOf).toISOString().slice(0, 10)}`], 'high');
  }
  if (latestCheckIn?.hasQuestions) {
    add('member_question', 'Member asked a question in check-in',
      'Draft reply seed: acknowledge the question directly in your review response.',
      ['Member-authored question present in latest check-in'], 'high');
  }
  if (latestCheckIn?.hasChallenges) {
    add('member_challenge', 'Member reported difficulties',
      'Consider discussing the reported challenge before changing the plan.',
      ['Member-authored challenge present in latest check-in'], 'high');
  }
  if (latestCheckIn?.energyLevel != null && latestCheckIn.energyLevel <= 2) {
    add('low_energy', 'Member reported low energy',
      'Consider a recovery-focused conversation or lighter week rather than pushing volume.',
      [`Latest check-in energy ${latestCheckIn.energyLevel}/5`], 'partial');
  }
  if (latestCheckIn?.workoutDifficulty != null && latestCheckIn.workoutDifficulty >= 4) {
    add('high_difficulty', 'Plan may be too hard right now',
      'Member rated difficulty high — consider reviewing loads or volume.',
      [`Latest check-in difficulty ${latestCheckIn.workoutDifficulty}/5`], 'partial');
  }
  if (s.activity.workoutsLast28d === 0) {
    add('training_gap', 'No logged workouts in ~4 weeks (shared data)',
      'Consider reaching out about barriers before assuming disengagement.',
      ['workout_records shared; 0 sessions in 28 days'], 'partial');
  } else if (s.activity.workoutsLast28d != null && s.activity.workoutsLast7d === 0) {
    add('training_pause', 'No workouts this week',
      'Member was active this month but not this week — a brief check-in question may help.',
      [`${s.activity.workoutsLast28d} sessions in 28d, 0 in 7d`], 'partial');
  }
  if (s.intake.status === 'none') {
    add('intake_missing', 'No baseline intake on file',
      'Consider inviting the member to start the progressive intake — any section order works.',
      ['No BaselineAssessment exists for this relationship'], 'high');
  } else if (s.intake.status === 'submitted') {
    add('intake_review', 'Intake awaiting your review',
      'A new intake version was submitted — review it to keep planning aligned.',
      [`Intake v${s.intake.version} submitted`], 'high');
  } else if (s.intake.status === 'in_progress') {
    add('intake_incomplete', 'Intake is still in progress',
      'Some sections may be missing — you can fill gaps together at the next session.',
      [`Intake v${s.intake.version} in progress`], 'partial');
  }
  if (!s.outcomePlan) {
    add('no_outcome_plan', 'No shared outcome plan yet',
      'Draft 1–3 shared goals with baseline, target and a review interval.',
      ['No active OutcomePlan for this relationship'], 'high');
  } else {
    const now = Date.now();
    const overdue = s.outcomePlan.goals.filter(g => g.status === 'open' && g.targetDate && new Date(g.targetDate).getTime() < now);
    if (overdue.length) {
      add('goal_review_due', `${overdue.length} goal${overdue.length > 1 ? 's' : ''} past target date`,
        'Open goals passed their target date — review together; extend, adjust or mark intentionally.',
        overdue.map(g => `"${g.title}" target ${new Date(g.targetDate).toISOString().slice(0, 10)}`), 'high');
    }
  }
  const pendingForm = s.formChecks.filter(f => f.status === 'submitted');
  if (pendingForm.length) {
    add('form_check_review', `${pendingForm.length} form-check video${pendingForm.length > 1 ? 's' : ''} awaiting feedback`,
      'Member-submitted video is waiting for your timestamped feedback.',
      pendingForm.map(f => `${f.exerciseName || 'Exercise'} submitted ${f.submittedAt ? new Date(f.submittedAt).toISOString().slice(0, 10) : 'recently'}`), 'high');
  }

  return {
    version: 'copilot-v1',
    generatedAt: s.generatedAt,
    relationId: relation.id,
    clientId,
    suggestions: out,
    draftDisclaimer: `${DRAFT_LABEL}. Suggestions are generated on read and never applied automatically — confirm by acting through the normal plan/check-in flows.`,
    dataCompleteness: s.consent.notShared.length ? `Hidden (not shared): ${s.consent.notShared.join(', ')}` : 'All consent categories shared',
  };
}

module.exports = { listClients, clientSummary, clientSuggestions, DRAFT_LABEL };

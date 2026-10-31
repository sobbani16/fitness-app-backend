// Trainer workout-plan lifecycle (advanced trainer platform, M2):
//   draft → publish → assign → client accept/decline → complete (+feedback)
// Versioning: revise() clones a published plan into a new draft and archives
// the old row (WorkoutPlan.version / supersedesId self-FK).
//
// Authorization: trainer-side writes go through requireApprovedTrainer /
// requireActiveRelation (trainerAccess); client-side reads/writes are scoped
// by ownership of the TrainerWorkoutAssignment row. Completion only links
// WorkoutSession.planAssignmentId — ExerciseSet/FoodLog semantics untouched.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireApprovedTrainer, requireActiveRelation, hasConsent } = require('./trainerAccess');

const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);
const PLAN_STATUSES = new Set(['draft', 'published', 'archived']);
const RESPOND_ACTIONS = { accept: 'accepted', decline: 'declined' };
// Assignment states that block a fresh assign for the same plan+client.
const OPEN_ASSIGNMENT_STATUSES = ['assigned', 'accepted'];
const MAX_DAY_INDEX = 6; // daysPerWeek maxes at 7

const bad = (msg) => httpError(400, msg);
const notFound = (msg) => httpError(404, msg || 'Not found.');
const conflict = (msg) => httpError(409, msg);

// Run fn inside the caller's transaction when one is passed (routes wrap the
// service call + audit row in coachingTransaction); otherwise open our own so
// multi-write operations stay atomic standalone.
function inTx(tx, fn) {
  return tx ? fn(tx) : getPrisma().$transaction(fn);
}

const PLAN_INCLUDE = {
  days: { orderBy: { dayIndex: 'asc' }, include: { exercises: { orderBy: { order: 'asc' } } } },
};

const PLAN_SUMMARY_SELECT = {
  id: true, title: true, description: true, goal: true, difficulty: true,
  durationWeeks: true, daysPerWeek: true, startAt: true, endAt: true,
  status: true, version: true,
  trainer: { select: { id: true, displayName: true, profilePicture: true } },
};

const SESSION_SELECT = {
  id: true, workoutType: true, startedAt: true, finishedAt: true,
  durationMinutes: true, caloriesBurned: true,
};

function planWithDays(db, planId) {
  return db.workoutPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
}

function assertOwnedPlan(plan, trainerId) {
  if (!plan || plan.trainerId !== trainerId) throw notFound('Plan not found.');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// null/undefined -> null; non-empty trimmed string otherwise (throws on bad type).
function optionalStr(v, name, max = 500) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !v.trim()) throw bad(`${name} must be a non-empty string.`);
  const t = v.trim();
  if (t.length > max) throw bad(`${name} is too long (max ${max}).`);
  return t;
}

function optionalInt(v, name, min, max) {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < min || v > max) {
    throw bad(`${name} must be an integer between ${min} and ${max}.`);
  }
  return v;
}

function optionalNum(v, name, min, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw bad(`${name} must be a number between ${min} and ${max}.`);
  }
  return v;
}

function optionalDate(v, name) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && !(v instanceof Date)) throw bad(`${name} must be an ISO date string.`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${name} must be an ISO date string.`);
  return d;
}

// Scalar plan fields. partial=true → only keys present in `data` are touched.
function planScalars(data, { partial }) {
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
  const out = {};
  if (!partial || has('title')) {
    const title = optionalStr(data.title, 'title', 200);
    if (!title) throw bad('title is required.');
    out.title = title;
  }
  if (!partial || has('description')) out.description = optionalStr(data.description, 'description', 2000);
  if (!partial || has('goal')) out.goal = optionalStr(data.goal, 'goal', 200);
  if (!partial || has('difficulty')) {
    const d = optionalStr(data.difficulty, 'difficulty', 50);
    if (d && !DIFFICULTIES.has(d)) throw bad('difficulty must be beginner, intermediate, or advanced.');
    out.difficulty = d;
  }
  if (!partial || has('durationWeeks')) out.durationWeeks = optionalInt(data.durationWeeks, 'durationWeeks', 1, 52);
  if (!partial || has('daysPerWeek')) out.daysPerWeek = optionalInt(data.daysPerWeek, 'daysPerWeek', 1, 7);
  if (!partial || has('startAt')) out.startAt = optionalDate(data.startAt, 'startAt');
  if (!partial || has('endAt')) out.endAt = optionalDate(data.endAt, 'endAt');
  return out;
}

function checkDateRange(startAt, endAt) {
  if (startAt && endAt && startAt >= endAt) throw bad('startAt must be before endAt.');
}

function normalizeExercises(list, dayIndex) {
  if (!Array.isArray(list)) throw bad(`days[${dayIndex}].exercises must be an array.`);
  return list.map((e, i) => {
    const at = `days[${dayIndex}].exercises[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw bad(`${at} must be an object.`);
    const exerciseName = optionalStr(e.exerciseName, `${at}.exerciseName`, 200);
    if (!exerciseName) throw bad(`${at}.exerciseName is required.`);
    if (!Number.isInteger(e.sets) || e.sets < 1 || e.sets > 100) {
      throw bad(`${at}.sets must be a positive integer (1-100).`);
    }
    const reps = optionalInt(e.reps, `${at}.reps`, 1, 10000);
    const repsText = optionalStr(e.repsText, `${at}.repsText`, 50);
    if (reps === null && repsText === null) throw bad(`${at} needs reps or repsText.`);
    const targetWeight = optionalNum(e.targetWeight, `${at}.targetWeight`, 0, 5000);
    const weightGuidance = optionalStr(e.weightGuidance, `${at}.weightGuidance`, 200);
    const restSeconds = optionalInt(e.restSeconds, `${at}.restSeconds`, 0, 3600);
    const tempo = optionalStr(e.tempo, `${at}.tempo`, 50);
    const progression = optionalStr(e.progression, `${at}.progression`, 200);
    const order = e.order === undefined || e.order === null
      ? i
      : optionalInt(e.order, `${at}.order`, 0, 1000);
    const exerciseId = e.exerciseId === undefined || e.exerciseId === null
      ? null
      : optionalStr(e.exerciseId, `${at}.exerciseId`, 64);
    return { exerciseName, exerciseId, sets: e.sets, reps, repsText, targetWeight, weightGuidance, restSeconds, tempo, progression, order };
  });
}

// days[] → normalized rows; enforces dayIndex < daysPerWeek (falls back to 0..6
// when the plan carries no daysPerWeek) and unique dayIndex per plan.
function normalizeDays(days, daysPerWeek) {
  if (!Array.isArray(days)) throw bad('days must be an array.');
  const maxIndex = Number.isInteger(daysPerWeek) ? daysPerWeek - 1 : MAX_DAY_INDEX;
  const seen = new Set();
  return days.map((d, i) => {
    const at = `days[${i}]`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw bad(`${at} must be an object.`);
    if (!Number.isInteger(d.dayIndex) || d.dayIndex < 0 || d.dayIndex > maxIndex) {
      throw bad(`${at}.dayIndex must be an integer between 0 and ${maxIndex}.`);
    }
    if (seen.has(d.dayIndex)) throw bad(`Duplicate dayIndex ${d.dayIndex}.`);
    seen.add(d.dayIndex);
    return {
      dayIndex: d.dayIndex,
      label: optionalStr(d.label, `${at}.label`, 200),
      warmup: optionalStr(d.warmup, `${at}.warmup`, 1000),
      cooldown: optionalStr(d.cooldown, `${at}.cooldown`, 1000),
      notes: optionalStr(d.notes, `${at}.notes`, 2000),
      exercises: normalizeExercises(d.exercises === undefined ? [] : d.exercises, d.dayIndex),
    };
  });
}

async function writeDays(db, planId, days) {
  for (const d of days) {
    await db.trainerWorkoutDay.create({
      data: {
        planId,
        dayIndex: d.dayIndex,
        label: d.label,
        warmup: d.warmup,
        cooldown: d.cooldown,
        notes: d.notes,
        exercises: { create: d.exercises },
      },
    });
  }
}

// exerciseId, when provided, must resolve to the Exercise catalog.
async function assertExerciseIds(db, days) {
  const ids = new Set();
  for (const d of days) for (const e of d.exercises) if (e.exerciseId) ids.add(e.exerciseId);
  for (const id of ids) {
    const ex = await db.exercise.findUnique({ where: { id } });
    if (!ex) throw bad(`exerciseId '${id}' not found in the exercise catalog.`);
  }
}

// Cursor pagination: take clamped 1-100, cursor = last seen row id.
function pagination(query = {}) {
  let take = 50;
  if (query.take !== undefined) {
    const n = Number(query.take);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw bad('take must be an integer between 1 and 100.');
    take = n;
  }
  const cursor = query.cursor === undefined || query.cursor === null || query.cursor === ''
    ? undefined
    : String(query.cursor);
  return { take, cursor };
}

function pageArgs(take, cursor) {
  return cursor ? { take: take + 1, skip: 1, cursor: { id: cursor } } : { take: take + 1 };
}

function pageOut(rows, take) {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

// ---------------------------------------------------------------------------
// Trainer-side lifecycle
// ---------------------------------------------------------------------------

async function createDraft(trainerUserId, data = {}, tx) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const scalars = planScalars(data, { partial: false });
  checkDateRange(scalars.startAt, scalars.endAt);
  const days = data.days !== undefined ? normalizeDays(data.days, scalars.daysPerWeek) : null;
  const prisma = getPrisma();
  if (days) await assertExerciseIds(prisma, days);
  return inTx(tx, async (t) => {
    const plan = await t.workoutPlan.create({
      data: { trainerId: trainer.id, clientId: null, status: 'draft', ...scalars },
    });
    if (days) await writeDays(t, plan.id, days);
    return planWithDays(t, plan.id);
  });
}

async function updateDraft(trainerUserId, planId, data = {}, tx) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await prisma.workoutPlan.findUnique({ where: { id: planId } });
  assertOwnedPlan(plan, trainer.id);
  if (plan.status !== 'draft') {
    throw conflict(`Plan is ${plan.status}; only drafts can be edited. Revise a published plan instead.`);
  }
  const scalars = planScalars(data, { partial: true });
  // Range check against the merged result (patch may move only one bound).
  const startAt = scalars.startAt !== undefined ? scalars.startAt : plan.startAt;
  const endAt = scalars.endAt !== undefined ? scalars.endAt : plan.endAt;
  checkDateRange(startAt, endAt);
  const effectiveDaysPerWeek = scalars.daysPerWeek !== undefined ? scalars.daysPerWeek : plan.daysPerWeek;
  const days = data.days !== undefined ? normalizeDays(data.days, effectiveDaysPerWeek) : null;
  if (days) await assertExerciseIds(prisma, days);
  return inTx(tx, async (t) => {
    if (Object.keys(scalars).length) {
      await t.workoutPlan.update({ where: { id: planId }, data: scalars });
    }
    if (days) {
      await t.trainerWorkoutDay.deleteMany({ where: { planId } });
      await writeDays(t, planId, days);
    }
    return planWithDays(t, planId);
  });
}

async function publish(trainerUserId, planId, tx) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await prisma.workoutPlan.findUnique({ where: { id: planId } });
  assertOwnedPlan(plan, trainer.id);
  if (plan.status !== 'draft') throw conflict(`Cannot publish a ${plan.status} plan.`);
  const ready = await prisma.trainerWorkoutDay.findFirst({
    where: { planId, exercises: { some: {} } },
  });
  if (!ready) throw bad('Add at least one day with at least one exercise before publishing.');
  return inTx(tx, (t) => t.workoutPlan.update({
    where: { id: planId },
    data: { status: 'published', active: true },
    include: PLAN_INCLUDE,
  }));
}

async function revise(trainerUserId, planId, tx) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await prisma.workoutPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  assertOwnedPlan(plan, trainer.id);
  if (plan.status !== 'published') {
    throw conflict(`Cannot revise a ${plan.status} plan; only published plans have versions.`);
  }
  return inTx(tx, async (t) => {
    await t.workoutPlan.update({ where: { id: planId }, data: { status: 'archived', active: false } });
    const draft = await t.workoutPlan.create({
      data: {
        trainerId: trainer.id,
        clientId: null,
        status: 'draft',
        title: plan.title,
        description: plan.description,
        goal: plan.goal,
        difficulty: plan.difficulty,
        durationWeeks: plan.durationWeeks,
        daysPerWeek: plan.daysPerWeek,
        startAt: plan.startAt,
        endAt: plan.endAt,
        version: plan.version + 1,
        supersedesId: plan.id,
      },
    });
    for (const d of plan.days) {
      await t.trainerWorkoutDay.create({
        data: {
          planId: draft.id,
          dayIndex: d.dayIndex,
          label: d.label,
          warmup: d.warmup,
          cooldown: d.cooldown,
          notes: d.notes,
          exercises: {
            create: d.exercises.map((e) => ({
              exerciseName: e.exerciseName,
              exerciseId: e.exerciseId,
              sets: e.sets,
              reps: e.reps,
              repsText: e.repsText,
              targetWeight: e.targetWeight,
              weightGuidance: e.weightGuidance,
              restSeconds: e.restSeconds,
              tempo: e.tempo,
              progression: e.progression,
              order: e.order,
            })),
          },
        },
      });
    }
    return planWithDays(t, draft.id);
  });
}

async function assign(trainerUserId, planId, clientUserId, tx) {
  const prisma = getPrisma();
  const { trainerId } = await requireActiveRelation({ trainerUserId, clientUserId });
  const plan = await prisma.workoutPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.trainerId !== trainerId) throw notFound('Plan not found.');
  if (plan.status !== 'published') throw conflict('Only published plans can be assigned.');
  const existing = await prisma.trainerWorkoutAssignment.findFirst({
    where: { planId, clientId: clientUserId, status: { in: OPEN_ASSIGNMENT_STATUSES } },
  });
  if (existing) throw conflict('This plan is already assigned to the client.');
  return inTx(tx, async (t) => {
    const assignment = await t.trainerWorkoutAssignment.create({
      data: { planId, clientId: clientUserId, status: 'assigned' },
    });
    // No dedicated trainer-notification helper exists; Notification is the
    // shared inbox model (same table the reminders inbox writes to).
    await t.notification.create({
      data: {
        userId: clientUserId,
        type: 'trainer.plan_assigned',
        title: 'New workout plan assigned',
        body: `Your coach assigned you the plan "${plan.title}".`,
      },
    });
    return assignment;
  });
}

// ---------------------------------------------------------------------------
// Client-side lifecycle
// ---------------------------------------------------------------------------

async function respondToAssignment(assignmentId, clientUserId, action, tx) {
  const prisma = getPrisma();
  const status = RESPOND_ACTIONS[action];
  if (!status) throw bad("action must be 'accept' or 'decline'.");
  const assignment = await prisma.trainerWorkoutAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.clientId !== clientUserId) throw notFound('Assignment not found.');
  if (assignment.status !== 'assigned') {
    throw conflict(`Assignment is already ${assignment.status}.`);
  }
  return inTx(tx, (t) => t.trainerWorkoutAssignment.update({
    where: { id: assignmentId },
    data: { status, respondedAt: new Date() },
  }));
}

async function addFeedback(assignmentId, clientUserId, data = {}, tx) {
  const prisma = getPrisma();
  const assignment = await prisma.trainerWorkoutAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.clientId !== clientUserId) throw notFound('Assignment not found.');
  if (!['accepted', 'completed'].includes(assignment.status)) {
    throw conflict('Feedback requires an accepted assignment.');
  }
  const rating = optionalInt(data.rating, 'rating', 1, 5);
  const note = optionalStr(data.note, 'note', 2000);
  const workoutSessionId = optionalStr(data.workoutSessionId, 'workoutSessionId', 64);
  if (rating === null && note === null) throw bad('Provide a rating or a note.');
  if (workoutSessionId) {
    const session = await prisma.workoutSession.findUnique({ where: { id: workoutSessionId } });
    if (!session || session.userId !== clientUserId) {
      throw bad('workoutSessionId must reference one of your own sessions.');
    }
  }
  return inTx(tx, (t) => t.trainerWorkoutFeedback.create({
    data: { assignmentId, clientId: clientUserId, workoutSessionId, rating, note },
  }));
}

async function completeAssignment(assignmentId, clientUserId, workoutSessionId, tx) {
  const prisma = getPrisma();
  const assignment = await prisma.trainerWorkoutAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.clientId !== clientUserId) throw notFound('Assignment not found.');
  if (assignment.status !== 'accepted') {
    throw conflict(`Assignment is ${assignment.status}; only accepted assignments can be completed.`);
  }
  const sessionId = optionalStr(workoutSessionId, 'workoutSessionId', 64);
  if (!sessionId) throw bad('workoutSessionId is required.');
  const session = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Workout session not found.');
  if (session.userId !== clientUserId) {
    throw httpError(403, 'Workout session belongs to another user.');
  }
  return inTx(tx, async (t) => {
    await t.workoutSession.update({ where: { id: session.id }, data: { planAssignmentId: assignmentId } });
    return t.trainerWorkoutAssignment.update({ where: { id: assignmentId }, data: { status: 'completed' } });
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listForTrainer(trainerUserId, query = {}) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const { take, cursor } = pagination(query);
  const where = { trainerId: trainer.id };
  if (query.status !== undefined) {
    if (!PLAN_STATUSES.has(query.status)) throw bad('status must be draft, published, or archived.');
    where.status = query.status;
  }
  const rows = await prisma.workoutPlan.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { _count: { select: { days: true, assignments: true } } },
    ...pageArgs(take, cursor),
  });
  const { items, nextCursor } = pageOut(rows, take);
  return { plans: items, nextCursor };
}

async function getForTrainer(trainerUserId, planId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await prisma.workoutPlan.findUnique({
    where: { id: planId },
    include: {
      ...PLAN_INCLUDE,
      assignments: { orderBy: [{ assignedAt: 'desc' }, { id: 'asc' }] },
    },
  });
  assertOwnedPlan(plan, trainer.id);
  return plan;
}

async function listForClient(clientUserId, query = {}) {
  const prisma = getPrisma();
  const { take, cursor } = pagination(query);
  const rows = await prisma.trainerWorkoutAssignment.findMany({
    where: { clientId: clientUserId },
    orderBy: [{ assignedAt: 'desc' }, { id: 'asc' }],
    include: { plan: { select: PLAN_SUMMARY_SELECT } },
    ...pageArgs(take, cursor),
  });
  const { items, nextCursor } = pageOut(rows, take);
  return { assignments: items, nextCursor };
}

async function getForClient(assignmentId, clientUserId) {
  const prisma = getPrisma();
  const assignment = await prisma.trainerWorkoutAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      plan: {
        include: {
          ...PLAN_INCLUDE,
          trainer: { select: { id: true, displayName: true, profilePicture: true } },
        },
      },
      feedback: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
    },
  });
  if (!assignment || assignment.clientId !== clientUserId) throw notFound('Assignment not found.');
  const sessions = await prisma.workoutSession.findMany({
    where: { planAssignmentId: assignmentId },
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    select: SESSION_SELECT,
  });
  return { ...assignment, sessions };
}

// Planned-vs-completed per assignment. The session list itself is workout
// records → gated on the relation's workout_records consent; the linked-count
// stays visible as assignment metadata either way.
async function progressForPlan(trainerUserId, planId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await prisma.workoutPlan.findUnique({
    where: { id: planId },
    include: { _count: { select: { days: true } } },
  });
  assertOwnedPlan(plan, trainer.id);
  const assignments = await prisma.trainerWorkoutAssignment.findMany({
    where: { planId },
    orderBy: [{ assignedAt: 'desc' }, { id: 'asc' }],
  });
  const plannedSessions = plan.daysPerWeek && plan.durationWeeks
    ? plan.daysPerWeek * plan.durationWeeks
    : null;
  const out = [];
  for (const a of assignments) {
    const sessions = await prisma.workoutSession.findMany({
      where: { planAssignmentId: a.id },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      select: SESSION_SELECT,
    });
    const relation = await prisma.trainerClient.findUnique({
      where: { trainerId_clientId: { trainerId: plan.trainerId, clientId: a.clientId } },
      select: { id: true },
    });
    const consent = relation ? await hasConsent(relation.id, 'workout_records') : false;
    out.push({
      id: a.id,
      clientId: a.clientId,
      status: a.status,
      assignedAt: a.assignedAt,
      respondedAt: a.respondedAt,
      plannedSessions,
      completedSessions: sessions.length,
      workoutRecordsConsent: consent,
      sessions: consent ? sessions : [],
    });
  }
  return {
    planId: plan.id,
    title: plan.title,
    status: plan.status,
    version: plan.version,
    daysCount: plan._count ? plan._count.days : undefined,
    plannedSessions,
    assignments: out,
  };
}

module.exports = {
  createDraft,
  updateDraft,
  publish,
  revise,
  assign,
  respondToAssignment,
  addFeedback,
  completeAssignment,
  listForTrainer,
  getForTrainer,
  listForClient,
  getForClient,
  progressForPlan,
};

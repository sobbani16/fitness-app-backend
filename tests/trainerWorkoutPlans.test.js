// Trainer workout-plans module — draft→publish→assign→respond→complete happy
// path, versioning, and the negative gates (unapproved trainer, cross-client
// reads, flag off, declined can't complete).
//
// Prisma is faked in memory (same pattern as tests/rbac.test.js). The parent
// flag trainer_advanced_features_enabled is class:'control', so setup.js does
// NOT enable it — flip both env overrides before the routers load. AUTH_TEST_BYPASS
// is set globally by tests/setup.js, so x-user-id headers carry identity.
process.env.FF_TRAINER_ADVANCED_FEATURES_ENABLED = 'true';
process.env.FF_TRAINER_WORKOUT_PLANS_ENABLED = 'true';

const express = require('express');
const request = require('supertest');
const flags = require('../src/services/featureFlags/service');

const mockDb = createDb();
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockDb }));

const app = express();
app.use(express.json());
app.use('/trainer/workout-plans', require('../src/routes/trainerWorkoutPlans'));
app.use('/me/workout-plans', require('../src/routes/myWorkoutPlans'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const TRAINER = 'trainer-1';
const TRAINER_PENDING = 'trainer-2';
const CLIENT = 'client-1';
const CLIENT2 = 'client-2';

const asTrainer = (req) => req.set('x-user-id', TRAINER);
const asClient = (req, id = CLIENT) => req.set('x-user-id', id);

function resetState() {
  const s = mockDb._state;
  s.plans.length = 0; s.days.length = 0; s.planExercises.length = 0;
  s.assignments.length = 0; s.feedback.length = 0; s.notifications.length = 0;
  s.sessions.length = 0; s.audit.length = 0;
}

async function makePublishedPlan() {
  const res = await asTrainer(request(app).post('/trainer/workout-plans')).send({
    title: 'Base Strength', goal: 'strength', difficulty: 'beginner',
    durationWeeks: 4, daysPerWeek: 3,
    days: [{ dayIndex: 0, label: 'Full Body A', warmup: '5min bike', exercises: [
      { exerciseName: 'Squat', exerciseId: 'ex-1', sets: 3, reps: 8, restSeconds: 120, tempo: '3-1-1' },
      { exerciseName: 'Push-up', sets: 3, repsText: '8-12' },
    ] }],
  });
  expect(res.status).toBe(201);
  const pub = await asTrainer(request(app).post(`/trainer/workout-plans/${res.body.id}/publish`));
  expect(pub.status).toBe(200);
  return pub.body;
}

// ---------------------------------------------------------------------------
// In-memory Prisma fake — implements only the calls the module makes.
// ---------------------------------------------------------------------------
function createDb() {
  let seq = 0;
  const nid = (p) => `${p}-${++seq}`;
  const iso = () => new Date().toISOString();

  const state = {
    trainers: [
      { id: 'tp-1', userId: 'trainer-1', verified: true, active: true, applicationStatus: 'approved', displayName: 'Coach One', profilePicture: null },
      { id: 'tp-2', userId: 'trainer-2', verified: false, active: true, applicationStatus: 'submitted', displayName: 'Coach Two', profilePicture: null },
    ],
    roles: {
      'trainer-1': ['TRAINER'],
      'trainer-2': ['TRAINER'],
      'client-1': ['MEMBER'],
      'client-2': ['MEMBER'],
    },
    clients: [
      { id: 'tc-1', trainerId: 'tp-1', clientId: 'client-1', status: 'active' },
      { id: 'tc-2', trainerId: 'tp-1', clientId: 'client-2', status: 'active' },
    ],
    consents: [
      { relationId: 'tc-1', category: 'workout_records', status: 'granted' },
    ],
    exercisesCatalog: [{ id: 'ex-1', name: 'Squat' }],
    plans: [], days: [], planExercises: [], assignments: [], feedback: [],
    notifications: [], sessions: [], audit: [],
  };

  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('in' in v) return v.in.includes(row[k]);
      return false; // unsupported filter shape
    }
    return row[k] === v;
  });
  const pick = (row, sel) => Object.fromEntries(
    Object.keys(sel).filter((k) => sel[k] === true).map((k) => [k, row[k]]));
  const page = (rows, { take, skip, cursor } = {}) => {
    let out = rows;
    if (cursor) {
      const i = out.findIndex((r) => r.id === cursor.id);
      out = i < 0 ? [] : out.slice(i + (skip || 0));
    } else if (skip) out = out.slice(skip);
    return take === undefined ? out : out.slice(0, take);
  };

  const dayWithEx = (d) => ({
    ...d,
    exercises: state.planExercises.filter((e) => e.dayId === d.id).sort((a, b) => a.order - b.order),
  });
  const planDays = (p) => state.days.filter((d) => d.planId === p.id)
    .sort((a, b) => a.dayIndex - b.dayIndex).map(dayWithEx);
  const trainerBrief = (tid) => {
    const t = state.trainers.find((x) => x.id === tid);
    return t ? { id: t.id, displayName: t.displayName, profilePicture: t.profilePicture } : null;
  };
  function withPlanInclude(p, include) {
    if (!include) return p;
    const out = { ...p };
    if (include.days) out.days = planDays(p);
    if (include.assignments) out.assignments = state.assignments.filter((a) => a.planId === p.id);
    if (include._count) {
      out._count = {
        days: state.days.filter((d) => d.planId === p.id).length,
        assignments: state.assignments.filter((a) => a.planId === p.id).length,
      };
    }
    if (include.trainer) out.trainer = trainerBrief(p.trainerId);
    return out;
  }
  function withAssignInclude(a, include) {
    if (!include) return a;
    const out = { ...a };
    if (include.plan) {
      const p = state.plans.find((x) => x.id === a.planId) || null;
      if (!p) out.plan = null;
      else if (include.plan.select) {
        out.plan = {};
        for (const k of Object.keys(include.plan.select)) {
          if (k === 'trainer') out.plan.trainer = trainerBrief(p.trainerId);
          else if (include.plan.select[k]) out.plan[k] = p[k];
        }
      } else out.plan = withPlanInclude(p, include.plan.include);
    }
    if (include.feedback) {
      out.feedback = state.feedback.filter((f) => f.assignmentId === a.id);
    }
    return out;
  }

  const db = {
    _state: state,
    $transaction: async (cb) => cb(db),
    userRole: {
      findMany: async ({ where }) => (state.roles[where.userId] || [])
        .map((name) => ({ userId: where.userId, active: true, role: { name } })),
    },
    trainerProfile: {
      findUnique: async ({ where }) =>
        state.trainers.find((t) => (where.userId && t.userId === where.userId) || (where.id && t.id === where.id)) || null,
    },
    trainerClient: {
      findUnique: async ({ where }) => {
        if (where.id) return state.clients.find((c) => c.id === where.id) || null;
        const key = where.trainerId_clientId || {};
        return state.clients.find((c) => c.trainerId === key.trainerId && c.clientId === key.clientId) || null;
      },
    },
    trainerClientConsent: {
      findUnique: async ({ where }) => {
        const key = where.relationId_category || {};
        return state.consents.find((c) => c.relationId === key.relationId && c.category === key.category) || null;
      },
    },
    exercise: {
      findUnique: async ({ where }) => state.exercisesCatalog.find((e) => e.id === where.id) || null,
    },
    workoutPlan: {
      create: async ({ data, include }) => {
        const p = { id: nid('plan'), createdAt: iso(), updatedAt: iso(), version: 1, status: 'published', active: true, ...data };
        state.plans.push(p);
        return withPlanInclude(p, include);
      },
      update: async ({ where, data, include }) => {
        const p = state.plans.find((x) => x.id === where.id);
        if (!p) throw new Error('record not found');
        Object.assign(p, data, { updatedAt: iso() });
        return withPlanInclude(p, include);
      },
      findUnique: async ({ where, include }) => {
        const p = state.plans.find((x) => x.id === where.id) || null;
        return p ? withPlanInclude(p, include) : null;
      },
      findMany: async ({ where, take, skip, cursor, include }) => {
        const rows = state.plans.filter((r) => matches(r, where))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
        return page(rows, { take, skip, cursor }).map((r) => withPlanInclude(r, include));
      },
    },
    trainerWorkoutDay: {
      create: async ({ data }) => {
        const d = { id: nid('day'), planId: data.planId, dayIndex: data.dayIndex, label: data.label ?? null, warmup: data.warmup ?? null, cooldown: data.cooldown ?? null, notes: data.notes ?? null };
        state.days.push(d);
        for (const e of data.exercises?.create || []) {
          state.planExercises.push({
            id: nid('pex'), dayId: d.id,
            exerciseName: e.exerciseName, exerciseId: e.exerciseId ?? null,
            sets: e.sets, reps: e.reps ?? null, repsText: e.repsText ?? null,
            targetWeight: e.targetWeight ?? null, weightGuidance: e.weightGuidance ?? null,
            restSeconds: e.restSeconds ?? null, tempo: e.tempo ?? null,
            progression: e.progression ?? null, order: e.order ?? 0,
          });
        }
        return d;
      },
      deleteMany: async ({ where }) => {
        const removed = new Set(state.days.filter((d) => matches(d, where)).map((d) => d.id));
        state.days = state.days.filter((d) => !removed.has(d.id));
        state.planExercises = state.planExercises.filter((e) => !removed.has(e.dayId));
        return { count: removed.size };
      },
      findFirst: async ({ where }) => state.days.find((d) =>
        matches(d, { planId: where.planId }) &&
        (!where.exercises || !where.exercises.some || state.planExercises.some((e) => e.dayId === d.id))) || null,
    },
    trainerWorkoutAssignment: {
      create: async ({ data }) => {
        const a = { id: nid('asg'), assignedAt: iso(), respondedAt: null, status: 'assigned', ...data };
        state.assignments.push(a);
        return a;
      },
      update: async ({ where, data }) => {
        const a = state.assignments.find((x) => x.id === where.id);
        if (!a) throw new Error('record not found');
        Object.assign(a, data);
        return a;
      },
      findFirst: async ({ where }) => state.assignments.find((a) => matches(a, where)) || null,
      findUnique: async ({ where, include }) => {
        const a = state.assignments.find((x) => x.id === where.id) || null;
        return a ? withAssignInclude(a, include) : null;
      },
      findMany: async ({ where, take, skip, cursor, include }) => {
        const rows = state.assignments.filter((r) => matches(r, where))
          .sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)) || String(a.id).localeCompare(String(b.id)));
        return page(rows, { take, skip, cursor }).map((r) => withAssignInclude(r, include));
      },
    },
    trainerWorkoutFeedback: {
      create: async ({ data }) => {
        const f = { id: nid('fb'), createdAt: iso(), ...data };
        state.feedback.push(f);
        return f;
      },
    },
    notification: {
      create: async ({ data }) => {
        const n = { id: nid('ntf'), createdAt: iso(), read: false, ...data };
        state.notifications.push(n);
        return n;
      },
    },
    workoutSession: {
      findUnique: async ({ where }) => state.sessions.find((s) => s.id === where.id) || null,
      findMany: async ({ where, select }) =>
        state.sessions.filter((s) => matches(s, where)).map((s) => (select ? pick(s, select) : s)),
      update: async ({ where, data }) => {
        const s = state.sessions.find((x) => x.id === where.id);
        if (!s) throw new Error('record not found');
        Object.assign(s, data);
        return s;
      },
    },
    auditLog: { create: async ({ data }) => { state.audit.push(data); return data; } },
    user: { findUnique: async () => null, create: async ({ data }) => data },
  };
  return db;
}

beforeEach(() => {
  resetState();
  process.env.FF_TRAINER_WORKOUT_PLANS_ENABLED = 'true';
  flags.resetCache();
});

// ---------------------------------------------------------------------------

describe('happy path: draft → publish → assign → accept → complete', () => {
  test('full lifecycle incl. client views, notification, session link, progress', async () => {
    // draft with a nested day + exercises
    const create = await asTrainer(request(app).post('/trainer/workout-plans')).send({
      title: 'Base Strength', description: '4-week intro', goal: 'strength',
      difficulty: 'beginner', durationWeeks: 4, daysPerWeek: 3,
      days: [{ dayIndex: 0, label: 'Full Body A', exercises: [
        { exerciseName: 'Squat', exerciseId: 'ex-1', sets: 3, reps: 8, restSeconds: 120 },
        { exerciseName: 'Push-up', sets: 3, repsText: '8-12' },
      ] }],
    });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('draft');
    expect(create.body.clientId).toBeNull();
    expect(create.body.days).toHaveLength(1);
    expect(create.body.days[0].exercises).toHaveLength(2);
    const planId = create.body.id;

    // patch draft: bump title + replace days
    const patch = await asTrainer(request(app).patch(`/trainer/workout-plans/${planId}`)).send({
      title: 'Base Strength v1.1',
      days: [{ dayIndex: 1, label: 'Pull Day', exercises: [
        { exerciseName: 'Row', sets: 4, reps: 6, weightGuidance: 'RPE 7' },
      ] }],
    });
    expect(patch.status).toBe(200);
    expect(patch.body.title).toBe('Base Strength v1.1');
    expect(patch.body.days).toHaveLength(1);
    expect(patch.body.days[0].dayIndex).toBe(1);
    expect(patch.body.days[0].exercises[0].exerciseName).toBe('Row');

    // publish
    const pub = await asTrainer(request(app).post(`/trainer/workout-plans/${planId}/publish`));
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');

    // assign to client-1 → notification row
    const asg = await asTrainer(request(app).post(`/trainer/workout-plans/${planId}/assign`)).send({ clientId: CLIENT });
    expect(asg.status).toBe(201);
    expect(asg.body.status).toBe('assigned');
    const assignmentId = asg.body.id;
    const notif = mockDb._state.notifications.find((n) => n.userId === CLIENT);
    expect(notif).toBeTruthy();
    expect(notif.type).toBe('trainer.plan_assigned');

    // client list + detail
    const list = await asClient(request(app).get('/me/workout-plans'));
    expect(list.status).toBe(200);
    expect(list.body.assignments).toHaveLength(1);
    expect(list.body.assignments[0].plan.title).toBe('Base Strength v1.1');
    expect(list.body.assignments[0].plan.trainer.displayName).toBe('Coach One');

    const detail = await asClient(request(app).get(`/me/workout-plans/${assignmentId}`));
    expect(detail.status).toBe(200);
    expect(detail.body.plan.days[0].exercises[0].exerciseName).toBe('Row');
    expect(detail.body.sessions).toHaveLength(0);

    // decline path sanity: second client can't see client-1's assignment
    expect((await asClient(request(app).get(`/me/workout-plans/${assignmentId}`), CLIENT2)).status).toBe(404);

    // accept
    const acc = await asClient(request(app).post(`/me/workout-plans/${assignmentId}/respond`)).send({ action: 'accept' });
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe('accepted');
    expect(acc.body.respondedAt).toBeTruthy();

    // feedback
    const fb = await asClient(request(app).post(`/me/workout-plans/${assignmentId}/feedback`)).send({ rating: 4, note: 'Tough but good' });
    expect(fb.status).toBe(201);
    expect(fb.body.rating).toBe(4);

    // log a workout session then complete against it
    mockDb._state.sessions.push({
      id: 'ws-1', userId: CLIENT, workoutType: 'strength', startedAt: new Date().toISOString(), durationMinutes: 45,
    });
    const done = await asClient(request(app).post(`/me/workout-plans/${assignmentId}/complete`)).send({ workoutSessionId: 'ws-1' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
    expect(mockDb._state.sessions.find((s) => s.id === 'ws-1').planAssignmentId).toBe(assignmentId);

    // trainer progress view: 1/12 planned sessions completed, consent granted → sessions listed
    const prog = await asTrainer(request(app).get(`/trainer/workout-plans/${planId}/progress`));
    expect(prog.status).toBe(200);
    expect(prog.body.plannedSessions).toBe(12); // 3 days/wk × 4 wk
    expect(prog.body.assignments).toHaveLength(1);
    expect(prog.body.assignments[0].completedSessions).toBe(1);
    expect(prog.body.assignments[0].workoutRecordsConsent).toBe(true);
    expect(prog.body.assignments[0].sessions).toHaveLength(1);
    expect(prog.body.assignments[0].sessions[0].id).toBe('ws-1');

    // audit trail captured plan lifecycle
    const actions = mockDb._state.audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['plan.create', 'plan.update', 'plan.publish', 'plan.assign', 'plan.assignment_respond', 'plan.assignment_complete']));
  });
});

describe('versioning', () => {
  test('revise clones plan+days+exercises to version+1 draft and archives old', async () => {
    const plan = await makePublishedPlan();
    const res = await asTrainer(request(app).post(`/trainer/workout-plans/${plan.id}/revise`));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.version).toBe(2);
    expect(res.body.supersedesId).toBe(plan.id);
    expect(res.body.id).not.toBe(plan.id);
    expect(res.body.title).toBe(plan.title);
    expect(res.body.days).toHaveLength(1);
    expect(res.body.days[0].exercises).toHaveLength(2);
    expect(res.body.days[0].exercises[0].exerciseName).toBe('Squat');
    expect(res.body.days[0].exercises[0].id).not.toBe(plan.days[0].exercises[0].id);

    const old = await asTrainer(request(app).get(`/trainer/workout-plans/${plan.id}`));
    expect(old.body.status).toBe('archived');
  });

  test('cannot revise a draft or edit a published plan', async () => {
    const draft = await asTrainer(request(app).post('/trainer/workout-plans')).send({ title: 'D' });
    expect((await asTrainer(request(app).post(`/trainer/workout-plans/${draft.body.id}/revise`))).status).toBe(409);
    const plan = await makePublishedPlan();
    expect((await asTrainer(request(app).patch(`/trainer/workout-plans/${plan.id}`)).send({ title: 'X' })).status).toBe(409);
  });
});

describe('negative gates', () => {
  test('unapproved trainer cannot create plans', async () => {
    const res = await request(app).post('/trainer/workout-plans')
      .set('x-user-id', TRAINER_PENDING)
      .send({ title: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/approved trainer/i);
  });

  test('non-trainer cannot reach trainer routes; non-client cannot read assignment', async () => {
    expect((await asClient(request(app).post('/trainer/workout-plans')).send({ title: 'X' })).status).toBe(403);
    const plan = await makePublishedPlan();
    const asg = await asTrainer(request(app).post(`/trainer/workout-plans/${plan.id}/assign`)).send({ clientId: CLIENT });
    const res = await asClient(request(app).get(`/me/workout-plans/${asg.body.id}`), CLIENT2);
    expect(res.status).toBe(404);
  });

  test('flag OFF → 403 FEATURE_DISABLED on both routers', async () => {
    process.env.FF_TRAINER_WORKOUT_PLANS_ENABLED = 'false';
    flags.resetCache();
    const res = await asTrainer(request(app).get('/trainer/workout-plans'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    const res2 = await asClient(request(app).get('/me/workout-plans'));
    expect(res2.status).toBe(403);
    expect(res2.body.error.code).toBe('FEATURE_DISABLED');
    process.env.FF_TRAINER_WORKOUT_PLANS_ENABLED = 'true';
    flags.resetCache();
  });

  test('declined assignment cannot complete; re-assign allowed after decline', async () => {
    const plan = await makePublishedPlan();
    const asg = await asTrainer(request(app).post(`/trainer/workout-plans/${plan.id}/assign`)).send({ clientId: CLIENT });
    const dec = await asClient(request(app).post(`/me/workout-plans/${asg.body.id}/respond`)).send({ action: 'decline' });
    expect(dec.body.status).toBe('declined');

    mockDb._state.sessions.push({ id: 'ws-9', userId: CLIENT, workoutType: 'strength', startedAt: new Date().toISOString(), durationMinutes: 30 });
    const done = await asClient(request(app).post(`/me/workout-plans/${asg.body.id}/complete`)).send({ workoutSessionId: 'ws-9' });
    expect(done.status).toBe(409);
    expect(mockDb._state.sessions[0].planAssignmentId).toBeUndefined();

    // declined slot frees the plan for a fresh assignment
    const again = await asTrainer(request(app).post(`/trainer/workout-plans/${plan.id}/assign`)).send({ clientId: CLIENT });
    expect(again.status).toBe(201);
  });

  test('publish requires content; assign requires published + active relation; validation', async () => {
    // empty draft can't publish
    const draft = await asTrainer(request(app).post('/trainer/workout-plans')).send({ title: 'Empty' });
    expect((await asTrainer(request(app).post(`/trainer/workout-plans/${draft.body.id}/publish`))).status).toBe(400);
    // drafts can't be assigned
    expect((await asTrainer(request(app).post(`/trainer/workout-plans/${draft.body.id}/assign`)).send({ clientId: CLIENT })).status).toBe(409);
    // bad sets / dayIndex / enum
    expect((await asTrainer(request(app).post('/trainer/workout-plans')).send({
      title: 'X', daysPerWeek: 2, days: [{ dayIndex: 0, exercises: [{ exerciseName: 'S', sets: 0, reps: 5 }] }],
    })).status).toBe(400);
    expect((await asTrainer(request(app).post('/trainer/workout-plans')).send({
      title: 'X', daysPerWeek: 2, days: [{ dayIndex: 2, exercises: [] }],
    })).status).toBe(400);
    expect((await asTrainer(request(app).post('/trainer/workout-plans')).send({ title: 'X', difficulty: 'elite' })).status).toBe(400);
    // unknown exerciseId rejected
    expect((await asTrainer(request(app).post('/trainer/workout-plans')).send({
      title: 'X', days: [{ dayIndex: 0, exercises: [{ exerciseName: 'S', exerciseId: 'nope', sets: 1, reps: 1 }] }],
    })).status).toBe(400);
    // no active relation → 403
    expect((await asTrainer(request(app).post(`/trainer/workout-plans/${draft.body.id}/assign`)).send({ clientId: 'stranger' })).status).toBe(403);
    // bad respond action
    expect((await asClient(request(app).post('/me/workout-plans/asg-x/respond')).send({ action: 'maybe' })).status).toBe(400);
  });
});

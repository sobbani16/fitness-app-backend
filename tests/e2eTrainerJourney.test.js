// End-to-end trainer-platform journey against the REAL local dev Postgres
// (DATABASE_URL -> localhost:5432/fitness_app) mounted through src/app.js.
// Fixture pattern mirrors tests/trainerNutrition.test.js: namespaced 'e2e-'
// rows created via prisma directly, removed in FK-safe order in afterAll.
//
// FF_* env overrides are set BEFORE src/app.js is required (env name = flag
// key uppercased). Most non-control flags are already enabled globally by
// tests/setup.js; the overrides that really matter here are the class:'control'
// parent trainer_advanced_features_enabled and trainer_paid_coaching_enabled.
process.env.FF_TRAINER_DASHBOARD = 'true';
process.env.FF_TRAINER_REGISTRATION = 'true';
process.env.FF_TRAINER_DISCOVERY = 'true';
process.env.FF_TRAINER_COACHING = 'true';
process.env.FF_TRAINER_INSIGHTS = 'true';
process.env.FF_TRAINER_ADVANCED_FEATURES_ENABLED = 'true';
process.env.FF_TRAINER_WORKOUT_PLANS_ENABLED = 'true';
process.env.FF_TRAINER_NUTRITION_GUIDANCE_ENABLED = 'true';
process.env.FF_TRAINER_MESSAGING_ENABLED = 'true';
process.env.FF_TRAINER_SCHEDULING_ENABLED = 'true';
process.env.FF_TRAINER_PAID_COACHING_ENABLED = 'true';

const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');
const { getProvider } = require('../src/services/payments/provider');
const scheduling = require('../src/services/schedulingService');

const prisma = getPrisma();
const app = require('../src/app');
const provider = getProvider('mock');

const ADMIN = 'e2e-admin';
const APPLICANT = 'e2e-applicant';
const TRAINER2 = 'e2e-trainer2';
const PENDING_TRAINER = 'e2e-pendingtrainer';
const CLIENT = 'e2e-client';
const CLIENT2 = 'e2e-client2';
const OUTSIDER = 'e2e-outsider';
const IDS = [ADMIN, APPLICANT, TRAINER2, PENDING_TRAINER, CLIENT, CLIENT2, OUTSIDER];

const auth = (id) => ({ 'x-user-id': id });
const setFlag = (key, value) => { process.env[envOverrideName(key)] = value; flags.resetCache(); };
const TZ = 'America/New_York';

jest.setTimeout(180000);

// Journey state shared across the ordered describes.
let trainer2Id;           // e2e-trainer2 profile id
let applicantTrainerId;   // applicant's TrainerProfile id (becomes the journey trainer)
let relationId;           // applicant-trainer <-> e2e-client relation id
let rel2PendingId;        // trainer2 <-> e2e-client2 pending relation id
let ingredientId;
let ingredient;           // picked from the real catalog (all macros non-null)
let workoutPlanId, workoutAssignmentId, workoutSessionId;
let nutritionPlanId, nutritionMealId, nutritionAssignmentId;
let conversationId;
let sessionTypeId, bookingId;
let packageId, purchaseId;

const relFilter = { OR: [{ clientId: { in: IDS } }, { trainer: { userId: { in: IDS } } }] };
const ownPlanTrainer = { trainer: { userId: { in: IDS } } };

async function cleanup() {
  // Scheduling / messaging children first.
  await prisma.trainerBookingEvent.deleteMany({ where: { booking: { relation: relFilter } } });
  await prisma.trainerBooking.deleteMany({ where: { relation: relFilter } });
  await prisma.message.deleteMany({ where: { conversation: { relation: relFilter } } });
  await prisma.conversation.deleteMany({ where: { relation: relFilter } });
  // Nutrition plan tree.
  await prisma.trainerNutritionFeedback.deleteMany({ where: { clientId: { in: IDS } } });
  await prisma.trainerNutritionAssignment.deleteMany({ where: { clientId: { in: IDS } } });
  await prisma.trainerNutritionPlanItem.deleteMany({ where: { meal: { plan: ownPlanTrainer } } });
  await prisma.trainerNutritionPlanMeal.deleteMany({ where: { plan: ownPlanTrainer } });
  await prisma.trainerNutritionTargets.deleteMany({ where: { plan: ownPlanTrainer } });
  await prisma.trainerNutritionPlan.deleteMany({ where: ownPlanTrainer });
  // Workout plan tree.
  await prisma.trainerWorkoutFeedback.deleteMany({ where: { clientId: { in: IDS } } });
  await prisma.trainerWorkoutAssignment.deleteMany({ where: { OR: [{ clientId: { in: IDS } }, { plan: ownPlanTrainer }] } });
  await prisma.trainerWorkoutExercise.deleteMany({ where: { day: { plan: ownPlanTrainer } } });
  await prisma.trainerWorkoutDay.deleteMany({ where: { plan: ownPlanTrainer } });
  await prisma.workoutPlan.deleteMany({ where: ownPlanTrainer });
  // Commerce tree.
  const trainerRows = await prisma.trainerProfile.findMany({ where: { userId: { in: IDS } }, select: { id: true } });
  const trainerIds = trainerRows.map((t) => t.id);
  await prisma.trainerEntitlement.deleteMany({ where: { OR: [{ clientId: { in: IDS } }, { trainerId: { in: trainerIds } }] } });
  await prisma.trainerSubscription.deleteMany({ where: { purchase: { clientId: { in: IDS } } } });
  await prisma.trainerRefund.deleteMany({ where: { purchase: { clientId: { in: IDS } } } });
  await prisma.trainerPaymentTransaction.deleteMany({ where: { purchase: { clientId: { in: IDS } } } });
  await prisma.trainerPurchase.deleteMany({ where: { clientId: { in: IDS } } });
  await prisma.trainerCoachingPackage.deleteMany({ where: { trainerId: { in: trainerIds } } });
  // Scheduling config on the trainer.
  await prisma.trainerAvailability.deleteMany({ where: ownPlanTrainer });
  await prisma.trainerSessionType.deleteMany({ where: ownPlanTrainer });
  await prisma.trainerSchedulingPreference.deleteMany({ where: ownPlanTrainer });
  // Relations + profiles.
  await prisma.trainerClientConsent.deleteMany({ where: { relation: relFilter } });
  await prisma.trainerDropForm.deleteMany({ where: { relation: relFilter } });
  await prisma.trainerClient.deleteMany({ where: relFilter });
  await prisma.trainerCertification.deleteMany({ where: ownPlanTrainer });
  await prisma.trainerProfile.deleteMany({ where: { userId: { in: IDS } } });
  // User-owned data + authz rows.
  await prisma.workoutSession.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.foodLog.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.weightEntry.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.sleepLog.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.dailySteps.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.notification.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: IDS } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: IDS } } });
}

async function role(name) {
  const r = await prisma.role.findUnique({ where: { name } });
  if (!r) throw new Error(`Role ${name} not seeded — run prisma/seed-rbac.js`);
  return r;
}

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  for (const id of IDS) {
    await prisma.user.create({
      data: { id, email: `${id}@test.local`, emailVerifiedAt: now, firstName: 'E2E', lastName: id.replace('e2e-', '') },
    });
  }
  const [adminRole, trainerRole, memberRole] = await Promise.all([role('ADMIN'), role('TRAINER'), role('MEMBER')]);
  const grants = [
    [ADMIN, adminRole.id], [TRAINER2, trainerRole.id], [PENDING_TRAINER, trainerRole.id],
    [APPLICANT, memberRole.id], [CLIENT, memberRole.id], [CLIENT2, memberRole.id], [OUTSIDER, memberRole.id],
  ];
  for (const [userId, roleId] of grants) {
    await prisma.userRole.create({ data: { userId, roleId, active: true } });
  }

  const t2 = await prisma.trainerProfile.create({
    data: {
      userId: TRAINER2, verified: true, active: true, applicationStatus: 'approved',
      displayName: 'E2E Trainer Two', isDiscoverable: true, specialties: ['yoga'],
      bio: 'Second approved trainer fixture', yearsExperience: 3, timeZone: TZ,
    },
  });
  trainer2Id = t2.id;
  await prisma.trainerProfile.create({
    data: {
      userId: PENDING_TRAINER, verified: false, active: true, applicationStatus: 'submitted',
      bio: 'Still under review', specialties: ['cardio'], yearsExperience: 1,
    },
  });

  // The client's pre-existing FoodLog — step 9 proves plan logging never
  // touches rows it didn't create.
  await prisma.foodLog.create({
    data: {
      userId: CLIENT, foodName: 'E2E pre-existing log', mealType: 'dinner',
      quantityG: 100, calories: 400, proteinG: 30, carbsG: 40, fatG: 10, loggedAt: now,
    },
  });

  // Any real ingredient with resolvable per-100g macros works for plan math.
  ingredient = await prisma.ingredient.findFirst({
    where: { caloriesPer100g: { gt: 0 }, proteinPer100g: { gt: 0 }, carbsPer100g: { gt: 0 }, fatPer100g: { gte: 0 } },
  });
  if (!ingredient) throw new Error('No usable ingredient in the dev catalog');
  ingredientId = ingredient.id;

  flags.resetCache();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
describe('step 1 — application draft -> submit', () => {
  test('draft, submit, /applications/me shows submitted', async () => {
    const draft = await request(app).post('/trainers/applications').set(auth(APPLICANT)).send({
      bio: 'E2E coach — strength specialist',
      specialties: ['strength_training'],
      yearsExperience: 5,
      displayName: 'E2E Coach',
      languages: ['en'],
      location: 'E2E City',
      country: 'US',
      timeZone: TZ,
    });
    expect(draft.status).toBe(201);
    expect(draft.body.applicationStatus).toBe('draft');
    applicantTrainerId = draft.body.id;
    expect(applicantTrainerId).toBeTruthy();

    const submit = await request(app).post('/trainers/applications/me/submit').set(auth(APPLICANT));
    expect(submit.status).toBe(200);
    expect(submit.body.applicationStatus).toBe('submitted');

    const mine = await request(app).get('/trainers/applications/me').set(auth(APPLICANT));
    expect(mine.status).toBe(200);
    expect(mine.body.applicationStatus).toBe('submitted');
  });
});

describe('step 2 — admin review approves', () => {
  test('not-yet-trainer is blocked from trainer surfaces, then approve works', async () => {
    // Negative while still 'submitted': no TRAINER role yet -> 403.
    const denied = await request(app).put('/trainer/schedule/availability').set(auth(APPLICANT))
      .send({ timeZone: TZ, windows: [{ weekday: 1, startMin: 540, endMin: 1020 }] });
    expect(denied.status).toBe(403);

    const res = await request(app).patch(`/admin/trainers/${applicantTrainerId}/review`).set(auth(ADMIN))
      .send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.applicationStatus).toBe('approved');
    expect(res.body.verified).toBe(true);
    expect(res.body.active).toBe(true);
    expect(res.body.approvedBy).toBe(ADMIN);

    const profile = await prisma.trainerProfile.findUnique({ where: { id: applicantTrainerId } });
    expect(profile.applicationStatus).toBe('approved');
  });
});

describe('step 3 — discovery + public profile', () => {
  test('GET /trainers?q= finds the new trainer; detail shows displayName', async () => {
    const list = await request(app).get('/trainers').query({ q: 'e2e coach' }).set(auth(CLIENT));
    expect(list.status).toBe(200);
    const found = list.body.trainers.find((t) => t.id === applicantTrainerId);
    expect(found).toBeDefined();
    expect(found.displayName).toBe('E2E Coach');

    const detail = await request(app).get(`/trainers/${applicantTrainerId}`).set(auth(CLIENT));
    expect(detail.status).toBe(200);
    expect(detail.body.displayName).toBe('E2E Coach');
    expect(detail.body.displayName).not.toBe(APPLICANT); // never the raw userId
  });
});

describe('step 4 — subscribe -> pending -> accept -> active', () => {
  test('client request, trainer sees it, accept activates', async () => {
    const sub = await request(app).post(`/trainers/${applicantTrainerId}/subscribe`).set(auth(CLIENT)).send({});
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe('pending');
    relationId = sub.body.id;
    expect(relationId).toBeTruthy();

    const pending = await request(app).get('/trainer-requests').set(auth(APPLICANT));
    expect(pending.status).toBe(200);
    expect(pending.body.requests.map((r) => r.id)).toContain(relationId);

    const accept = await request(app).post(`/trainer-requests/${relationId}/accept`).set(auth(APPLICANT));
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('active');
    expect(accept.body.lockedUntil).toBeTruthy();
  });
});

describe('step 5 — client grants selected consents only', () => {
  test('PUT consents grants workout_records + weight_trends only', async () => {
    const res = await request(app).put(`/trainer-relationships/${relationId}/consents`).set(auth(CLIENT))
      .send({ grants: ['workout_records', 'weight_trends'] });
    expect(res.status).toBe(200);
    const byCat = Object.fromEntries(res.body.consents.map((c) => [c.category, c.status]));
    expect(res.body.consents).toHaveLength(8);
    expect(byCat.workout_records).toBe('granted');
    expect(byCat.weight_trends).toBe('granted');
    for (const c of ['food_logs', 'nutrition_summaries', 'sleep_summaries', 'step_counts', 'body_measurements', 'health_scores']) {
      expect(byCat[c]).toBe('pending');
    }
  });
});

describe('step 6 — consent-filtered trainer progress view', () => {
  test('workoutSessions + weight present; sleep/steps/macroScores/healthScores absent', async () => {
    // Fixtures land after the relation went active so they fall inside the
    // engagement window (startedAt >= relation.startedAt).
    const now = new Date();
    await prisma.weightEntry.create({ data: { userId: CLIENT, weightKg: 82.5, recordedAt: now } });
    await prisma.workoutSession.create({
      data: {
        userId: CLIENT, workoutType: 'strength', startedAt: now,
        endedAt: new Date(now.getTime() + 45 * 60000), durationMinutes: 45,
      },
    });
    // Rows exist for ungranted categories too — they must still be filtered out.
    await prisma.sleepLog.create({
      data: { userId: CLIENT, sleepStart: now, sleepEnd: new Date(now.getTime() + 7 * 3600e3), hoursSlept: 7 },
    });
    await prisma.dailySteps.create({ data: { userId: CLIENT, date: now, steps: 9000 } });

    const res = await request(app).get(`/trainers/clients/${CLIENT}/progress`).set(auth(APPLICANT));
    expect(res.status).toBe(200);
    expect(res.body.grantedCategories).toEqual(expect.arrayContaining(['workout_records', 'weight_trends']));
    expect(Array.isArray(res.body.workoutSessions)).toBe(true);
    expect(res.body.workoutSessions.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.weight)).toBe(true);
    expect(res.body.weight.length).toBeGreaterThanOrEqual(1);
    for (const key of ['sleep', 'steps', 'macroScores', 'healthScores']) {
      expect(res.body[key]).toBeUndefined();
    }
  });
});

describe('step 7 — workout plan lifecycle', () => {
  test('draft -> patch days -> publish -> assign -> client accept -> complete', async () => {
    const create = await request(app).post('/trainer/workout-plans').set(auth(APPLICANT)).send({
      title: 'E2E Strength Block', goal: 'strength', difficulty: 'beginner',
      durationWeeks: 2, daysPerWeek: 2,
      days: [{ dayIndex: 0, label: 'Day A', exercises: [{ exerciseName: 'Squat', sets: 3, reps: 8 }] }],
    });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('draft');
    workoutPlanId = create.body.id;

    const patch = await request(app).patch(`/trainer/workout-plans/${workoutPlanId}`).set(auth(APPLICANT)).send({
      days: [
        { dayIndex: 0, label: 'Day A', exercises: [{ exerciseName: 'Squat', sets: 3, reps: 8 }] },
        { dayIndex: 1, label: 'Day B', exercises: [{ exerciseName: 'Row', sets: 4, reps: 6 }] },
      ],
    });
    expect(patch.status).toBe(200);
    expect(patch.body.days).toHaveLength(2);
    expect(patch.body.days[1].exercises[0].exerciseName).toBe('Row');

    const pub = await request(app).post(`/trainer/workout-plans/${workoutPlanId}/publish`).set(auth(APPLICANT));
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');

    const asg = await request(app).post(`/trainer/workout-plans/${workoutPlanId}/assign`).set(auth(APPLICANT))
      .send({ clientId: CLIENT });
    expect(asg.status).toBe(201);
    expect(asg.body.status).toBe('assigned');
    workoutAssignmentId = asg.body.id;

    const list = await request(app).get('/me/workout-plans').set(auth(CLIENT));
    expect(list.status).toBe(200);
    expect(list.body.assignments.map((a) => a.id)).toContain(workoutAssignmentId);

    const respond = await request(app).post(`/me/workout-plans/${workoutAssignmentId}/respond`).set(auth(CLIENT))
      .send({ action: 'accept' });
    expect(respond.status).toBe(200);
    expect(respond.body.status).toBe('accepted');

    const now = new Date();
    const session = await prisma.workoutSession.create({
      data: {
        userId: CLIENT, workoutType: 'strength', startedAt: now,
        endedAt: new Date(now.getTime() + 50 * 60000), durationMinutes: 50,
      },
    });
    workoutSessionId = session.id;

    const done = await request(app).post(`/me/workout-plans/${workoutAssignmentId}/complete`).set(auth(CLIENT))
      .send({ workoutSessionId });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
    const linked = await prisma.workoutSession.findUnique({ where: { id: workoutSessionId } });
    expect(linked.planAssignmentId).toBe(workoutAssignmentId);
  });
});

describe('step 8 — trainer sees plan progress', () => {
  test('GET /trainer/workout-plans/:id/progress shows the completed session', async () => {
    const res = await request(app).get(`/trainer/workout-plans/${workoutPlanId}/progress`).set(auth(APPLICANT));
    expect(res.status).toBe(200);
    expect(res.body.plannedSessions).toBe(4); // 2 days/wk x 2 wk
    const mine = res.body.assignments.find((a) => a.id === workoutAssignmentId);
    expect(mine).toBeDefined();
    expect(mine.completedSessions).toBe(1);
    expect(mine.workoutRecordsConsent).toBe(true);
    expect(mine.sessions.map((s) => s.id)).toContain(workoutSessionId);
  });
});

describe('step 9 — nutrition plan lifecycle + FoodLog write path', () => {
  test('draft -> preview -> publish -> assign -> accept -> log creates client FoodLog only', async () => {
    const create = await request(app).post('/trainer/nutrition-plans').set(auth(APPLICANT)).send({
      title: 'E2E Nutrition Day',
      guidanceText: 'Hit your protein target.',
      targets: { caloriesKcal: 2000, proteinG: 150 },
      meals: [{ mealType: 'lunch', items: [{ ingredientId, quantityG: 150 }] }],
    });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('draft');
    nutritionPlanId = create.body.id;
    nutritionMealId = create.body.meals[0].id;
    const planItemId = create.body.meals[0].items[0].id;

    const preview = await request(app).get(`/trainer/nutrition-plans/${nutritionPlanId}/preview`).set(auth(APPLICANT));
    expect(preview.status).toBe(200);
    expect(preview.body.complete).toBe(true);
    expect(preview.body.totals.calories).toBeCloseTo((ingredient.caloriesPer100g * 150) / 100, 1);
    expect(preview.body.disclaimer).toMatch(/not medical nutrition therapy/i);

    const pub = await request(app).post(`/trainer/nutrition-plans/${nutritionPlanId}/publish`).set(auth(APPLICANT));
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');

    const asg = await request(app).post(`/trainer/nutrition-plans/${nutritionPlanId}/assign`).set(auth(APPLICANT))
      .send({ clientId: CLIENT });
    expect(asg.status).toBe(201);
    nutritionAssignmentId = asg.body.assignment.id;
    expect(asg.body.assignment.status).toBe('assigned');

    const list = await request(app).get('/me/nutrition-plans').set(auth(CLIENT));
    expect(list.status).toBe(200);
    expect(list.body.assignments.map((a) => a.id)).toContain(nutritionAssignmentId);

    const respond = await request(app).post(`/me/nutrition-plans/${nutritionAssignmentId}/respond`).set(auth(CLIENT))
      .send({ action: 'accept' });
    expect(respond.status).toBe(200);
    expect(respond.body.assignment.status).toBe('accepted');

    const preExisting = await prisma.foodLog.findMany({ where: { userId: CLIENT } });
    expect(preExisting).toHaveLength(1); // only the beforeAll fixture
    const beforeCount = preExisting.length;

    const log = await request(app).post(`/me/nutrition-plans/${nutritionAssignmentId}/log`).set(auth(CLIENT))
      .send({ mealId: nutritionMealId, items: [{ itemId: planItemId }] });
    expect(log.status).toBe(201);
    expect(log.body.logs).toHaveLength(1);
    const entry = log.body.logs[0];
    expect(entry.userId).toBe(CLIENT);
    expect(entry.mealType).toBe('lunch');
    expect(entry.ingredientId).toBe(ingredientId);
    expect(entry.calories).toBeCloseTo((ingredient.caloriesPer100g * 150) / 100, 1);
    expect(entry.nutritionSnapshot.source).toBe('trainer_plan');
    expect(entry.nutritionSnapshot.trainerPlanId).toBe(nutritionPlanId);

    const after = await prisma.foodLog.findMany({ where: { userId: CLIENT }, orderBy: { loggedAt: 'asc' } });
    expect(after).toHaveLength(beforeCount + 1);
    // The pre-existing row is untouched.
    const intact = after.find((l) => l.foodName === 'E2E pre-existing log');
    expect(intact).toBeDefined();
    expect(intact.calories).toBe(400);
    expect(intact.nutritionSnapshot).toBeNull();
  });
});

describe('step 10 — messaging', () => {
  test('trainer opens conversation, sends, client unread 1 -> read -> 0', async () => {
    const conv = await request(app).post(`/conversations/with/${CLIENT}`).set(auth(APPLICANT));
    expect([200, 201]).toContain(conv.status);
    conversationId = conv.body.conversation.id;
    expect(conversationId).toBeTruthy();

    const sent = await request(app).post(`/conversations/${conversationId}/messages`).set(auth(APPLICANT))
      .send({ body: 'E2E: welcome aboard!' });
    expect(sent.status).toBe(201);
    expect(sent.body.message.body).toBe('E2E: welcome aboard!');

    const list = await request(app).get('/conversations').set(auth(CLIENT));
    expect(list.status).toBe(200);
    const mine = list.body.conversations.find((c) => c.id === conversationId);
    expect(mine).toBeDefined();
    expect(mine.unreadCount).toBe(1);
    expect(mine.lastMessage.body).toBe('E2E: welcome aboard!');

    const msgs = await request(app).get(`/conversations/${conversationId}/messages`).set(auth(CLIENT));
    expect(msgs.status).toBe(200);
    expect(msgs.body.messages.map((m) => m.body)).toContain('E2E: welcome aboard!');

    const read = await request(app).post(`/conversations/${conversationId}/read`).set(auth(CLIENT))
      .send({ lastMessageId: sent.body.message.id });
    expect(read.status).toBe(200);
    expect(read.body.markedRead).toBe(1);

    const after = await request(app).get('/conversations').set(auth(CLIENT));
    expect(after.body.conversations.find((c) => c.id === conversationId).unreadCount).toBe(0);
  });
});

describe('step 11 — scheduling + booking lifecycle', () => {
  test('availability -> slots -> book -> confirm -> reschedule -> cancel', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600e3);
    const weekday = scheduling.localDateParts(TZ, tomorrow).weekday;

    const avail = await request(app).put('/trainer/schedule/availability').set(auth(APPLICANT))
      .send({ timeZone: TZ, windows: [{ weekday, startMin: 540, endMin: 1020 }] }); // 9:00-17:00
    expect(avail.status).toBe(200);
    expect(avail.body.availability).toHaveLength(1);

    const st = await request(app).post('/trainer/schedule/session-types').set(auth(APPLICANT))
      .send({ name: 'E2E Coaching Session', durationMin: 60, minNoticeMin: 0, cancelWindowMin: 0 });
    expect(st.status).toBe(201);
    sessionTypeId = st.body.id;

    const from = new Date();
    const to = new Date(Date.now() + 4 * 24 * 3600e3);
    const slots = await request(app).get('/me/available-slots').set(auth(CLIENT))
      .query({ trainerId: applicantTrainerId, sessionTypeId, from: from.toISOString(), to: to.toISOString() });
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBeGreaterThanOrEqual(2);

    const book = await request(app).post('/me/bookings').set(auth(CLIENT))
      .send({ relationId, sessionTypeId, startAtUtc: slots.body.slots[0], clientNote: 'first session' });
    expect(book.status).toBe(201);
    expect(book.body.status).toBe('requested');
    bookingId = book.body.id;

    const confirm = await request(app).post(`/trainer/schedule/bookings/${bookingId}/respond`).set(auth(APPLICANT))
      .send({ action: 'confirm' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('confirmed');

    const newStart = slots.body.slots[slots.body.slots.length - 1];
    const moved = await request(app).post(`/me/bookings/${bookingId}/reschedule`).set(auth(CLIENT))
      .send({ startAtUtc: newStart });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('rescheduled');
    expect(moved.body.startAtUtc).toBe(newStart);

    const cancel = await request(app).post(`/me/bookings/${bookingId}/cancel`).set(auth(CLIENT)).send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('canceled');
  });
});

describe('step 12 — consent revocation hides the section', () => {
  test('revoke workout_records -> progress no longer returns workoutSessions', async () => {
    const res = await request(app).put(`/trainer-relationships/${relationId}/consents`).set(auth(CLIENT))
      .send({ revokes: ['workout_records'] });
    expect(res.status).toBe(200);

    const progress = await request(app).get(`/trainers/clients/${CLIENT}/progress`).set(auth(APPLICANT));
    expect(progress.status).toBe(200);
    expect(progress.body.workoutSessions).toBeUndefined();
    expect(progress.body.grantedCategories).not.toContain('workout_records');
    expect(progress.body.weight).toBeDefined(); // weight_trends still granted
  });
});

describe('step 13 — messaging flag enforcement', () => {
  test('FF off -> 403 FEATURE_DISABLED; flip back restores', async () => {
    setFlag('trainer_messaging_enabled', 'false');
    const res = await request(app).post(`/conversations/${conversationId}/messages`).set(auth(APPLICANT))
      .send({ body: 'should be blocked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');

    setFlag('trainer_messaging_enabled', 'true');
    const ok = await request(app).post(`/conversations/${conversationId}/messages`).set(auth(APPLICANT))
      .send({ body: 'flag is back' });
    expect(ok.status).toBe(201);
  });
});

describe('step 14 — authorization negatives', () => {
  test('outsider cannot read client progress', async () => {
    const res = await request(app).get(`/trainers/clients/${CLIENT}/progress`).set(auth(OUTSIDER));
    expect(res.status).toBe(403);
  });

  test('submitted (unapproved) trainer cannot create workout plans', async () => {
    const res = await request(app).post('/trainer/workout-plans').set(auth(PENDING_TRAINER))
      .send({ title: 'Not allowed' });
    expect(res.status).toBe(403);
  });

  test('cross-trainer pending request list shows only own', async () => {
    // e2e-client2 requests e2e-trainer2 — a different trainer's pipeline.
    const sub = await request(app).post(`/trainers/${trainer2Id}/subscribe`).set(auth(CLIENT2)).send({});
    expect(sub.status).toBe(201);
    rel2PendingId = sub.body.id;

    const list = await request(app).get('/trainer-requests').set(auth(TRAINER2));
    expect(list.status).toBe(200);
    expect(list.body.requests.length).toBeGreaterThanOrEqual(1);
    for (const r of list.body.requests) expect(r.trainerId).toBe(trainer2Id);
    expect(list.body.requests.map((r) => r.id)).toContain(rel2PendingId);
    // The applicant-trainer's relation with e2e-client never leaks across.
    expect(list.body.requests.map((r) => r.id)).not.toContain(relationId);
  });
});

describe('step 15 — paid coaching checkout -> webhook -> entitlement', () => {
  test('package, pending purchase, signed webhook activates entitlement; no-relation buyer 403', async () => {
    const pkg = await request(app).post('/trainer/commerce/packages').set(auth(APPLICANT))
      .send({ title: 'E2E 5-Session Pack', kind: 'session_pack', sessionCount: 5, priceCents: 5000 });
    expect(pkg.status).toBe(201);
    packageId = pkg.body.id;

    const checkout = await request(app).post('/me/purchases/checkout').set(auth(CLIENT))
      .send({ packageId, idempotencyKey: 'e2e-checkout-key-1' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.purchase.status).toBe('pending');
    purchaseId = checkout.body.purchase.id;
    const providerRef = checkout.body.checkout.providerRef;
    expect(providerRef).toMatch(/^mock_co_/);

    const { event, headers } = provider.issueEvent('payment.succeeded', {
      id: 'evt-e2e-journey-1', purchaseId, providerRef, amountCents: 5000, currency: 'usd',
    });
    const hook = await request(app).post('/webhooks/payments/mock').send(event)
      .set('x-mock-signature', headers['x-mock-signature']);
    expect(hook.status).toBe(200);
    expect(hook.body.processed).toBe(true);

    const ent = await request(app).get('/me/entitlements').set(auth(CLIENT));
    expect(ent.status).toBe(200);
    const mine = ent.body.entitlements.find((e) => e.purchaseId === purchaseId);
    expect(mine).toBeDefined();
    expect(mine.status).toBe('active');
    expect(mine.kind).toBe('session_pack');
    expect(mine.remainingSessions).toBe(5);

    // An unrelated user cannot buy coaching they have no relationship for.
    const denied = await request(app).post('/me/purchases/checkout').set(auth(OUTSIDER))
      .send({ packageId, idempotencyKey: 'e2e-checkout-key-2' });
    expect(denied.status).toBe(403);
  });
});

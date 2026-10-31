// Scheduling: availability, slot computation (incl. DST), booking lifecycle.
// Routers are not mounted in src/routes/index.js yet — this suite mounts them
// on a local express app exactly where the reported mount lines will go.
const request = require('supertest');
const express = require('express');

// ---------------------------------------------------------------------------
// In-memory Prisma fake (subset used by schedulingService + middleware)
// ---------------------------------------------------------------------------
const TRAINER_USER = 'trainer-1';
const TRAINER_ID = 'tp-1';
const CLIENT = 'client-1';
const OTHER_CLIENT = 'client-2';
const REL_ID = 'rel-1';

const store = {};

function resetStore() {
  store.trainers = [
    { id: TRAINER_ID, userId: TRAINER_USER, verified: true, active: true, applicationStatus: 'approved', displayName: 'Coach C', timeZone: 'UTC' },
  ];
  store.relations = [
    { id: REL_ID, trainerId: TRAINER_ID, clientId: CLIENT, status: 'active' },
    { id: 'rel-dropped', trainerId: TRAINER_ID, clientId: OTHER_CLIENT, status: 'dropped' },
  ];
  store.prefs = [];
  store.availability = [];
  store.sessionTypes = [];
  store.bookings = [];
  store.bookingEvents = [];
  store.notifications = [];
  store.audit = [];
  store.seq = 0;
}
resetStore();

const nid = (p) => `${p}-${++store.seq}`;
const relationFor = (b) => store.relations.find((r) => r.id === b.relationId) || null;
const trainerFor = (rel) => store.trainers.find((t) => t.id === rel?.trainerId) || null;

function decorateBooking(b) {
  const relation = relationFor(b);
  return {
    ...b,
    relation: relation ? { ...relation, trainer: trainerFor(relation) } : null,
    sessionType: store.sessionTypes.find((s) => s.id === b.sessionTypeId) || null,
  };
}

function cmpInstant(value, cond) {
  const v = +new Date(value);
  if (cond instanceof Date) return v === +cond;
  for (const [op, x] of Object.entries(cond || {})) {
    const t = +new Date(x);
    if (op === 'lt' && !(v < t)) return false;
    if (op === 'lte' && !(v <= t)) return false;
    if (op === 'gt' && !(v > t)) return false;
    if (op === 'gte' && !(v >= t)) return false;
  }
  return true;
}

function bookingMatch(b, where) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'relation') {
      const rel = relationFor(b) || {};
      for (const [rk, rv] of Object.entries(cond)) if (rel[rk] !== rv) return false;
    } else if (key === 'status') {
      if (cond && typeof cond === 'object' && 'in' in cond) { if (!cond.in.includes(b.status)) return false; }
      else if (b.status !== cond) return false;
    } else if (key === 'id') {
      if (cond && typeof cond === 'object' && 'not' in cond) { if (b.id === cond.not) return false; }
      else if (b.id !== cond) return false;
    } else if (key === 'startAtUtc' || key === 'endAtUtc') {
      if (!cmpInstant(b[key], cond)) return false;
    } else if (key === 'relationId' || key === 'sessionTypeId') {
      if (b[key] !== cond) return false;
    }
  }
  return true;
}

function applySelect(row, select) {
  if (!select) return row;
  const out = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

function sortTake(rows, orderBy, take) {
  const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  const out = [...rows];
  for (const ord of [...orders].reverse()) {
    const [field, dir] = Object.entries(ord)[0];
    out.sort((a, b) => {
      const av = a[field] instanceof Date ? +a[field] : a[field];
      const bv = b[field] instanceof Date ? +b[field] : b[field];
      return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === 'desc' ? -1 : 1);
    });
  }
  return take ? out.slice(0, take) : out;
}

const mockPrisma = {
  userRole: {
    findMany: jest.fn(async ({ where: { userId } }) =>
      userId === TRAINER_USER ? [{ userId, active: true, role: { name: 'TRAINER' } }] : []),
  },
  trainerProfile: {
    findUnique: jest.fn(async ({ where }) => {
      if (where.userId) return store.trainers.find((t) => t.userId === where.userId) || null;
      if (where.id) return store.trainers.find((t) => t.id === where.id) || null;
      return null;
    }),
  },
  trainerClient: {
    findUnique: jest.fn(async ({ where }) => {
      let rel = null;
      if (where.id) rel = store.relations.find((r) => r.id === where.id) || null;
      else if (where.trainerId_clientId) {
        const { trainerId, clientId } = where.trainerId_clientId;
        rel = store.relations.find((r) => r.trainerId === trainerId && r.clientId === clientId) || null;
      }
      return rel ? { ...rel, trainer: trainerFor(rel) } : null;
    }),
  },
  trainerSchedulingPreference: {
    findUnique: jest.fn(async ({ where: { trainerId } }) => store.prefs.find((p) => p.trainerId === trainerId) || null),
    upsert: jest.fn(async ({ where: { trainerId }, create, update }) => {
      const existing = store.prefs.find((p) => p.trainerId === trainerId);
      if (existing) return Object.assign(existing, update);
      const row = { id: nid('pref'), ...create };
      store.prefs.push(row);
      return row;
    }),
  },
  trainerAvailability: {
    findMany: jest.fn(async ({ where }) => sortTake(store.availability.filter((w) => w.trainerId === where.trainerId), undefined)),
    createMany: jest.fn(async ({ data }) => { store.availability.push(...data.map((d) => ({ id: nid('av'), ...d }))); return { count: data.length }; }),
    deleteMany: jest.fn(async ({ where }) => {
      const before = store.availability.length;
      store.availability = store.availability.filter((w) => w.trainerId !== where.trainerId);
      return { count: before - store.availability.length };
    }),
  },
  trainerSessionType: {
    create: jest.fn(async ({ data }) => { const row = { id: nid('st'), active: true, bufferMin: 0, minNoticeMin: 1440, cancelWindowMin: 1440, mode: 'virtual', ...data }; store.sessionTypes.push(row); return row; }),
    findUnique: jest.fn(async ({ where: { id } }) => store.sessionTypes.find((s) => s.id === id) || null),
    findMany: jest.fn(async ({ where = {} }) =>
      store.sessionTypes.filter((s) => (where.trainerId === undefined || s.trainerId === where.trainerId) && (where.active === undefined || s.active === where.active))),
    update: jest.fn(async ({ where: { id }, data }) => {
      const row = store.sessionTypes.find((s) => s.id === id);
      return row ? Object.assign(row, data) : null;
    }),
    delete: jest.fn(async ({ where: { id } }) => {
      const row = store.sessionTypes.find((s) => s.id === id);
      store.sessionTypes = store.sessionTypes.filter((s) => s.id !== id);
      return row;
    }),
  },
  trainerBooking: {
    create: jest.fn(async ({ data }) => { const row = { id: nid('bk'), createdAt: new Date(), updatedAt: new Date(), ...data }; store.bookings.push(row); return row; }),
    update: jest.fn(async ({ where: { id }, data }) => {
      const row = store.bookings.find((b) => b.id === id);
      return row ? Object.assign(row, data) : null;
    }),
    findUnique: jest.fn(async ({ where: { id } }) => {
      const row = store.bookings.find((b) => b.id === id);
      return row ? decorateBooking(row) : null;
    }),
    findFirst: jest.fn(async ({ where, select }) => {
      const row = store.bookings.find((b) => bookingMatch(b, where));
      return row ? applySelect(decorateBooking(row), select) : null;
    }),
    findMany: jest.fn(async ({ where, select, orderBy, take } = {}) => {
      const rows = sortTake(store.bookings.filter((b) => bookingMatch(b, where)), orderBy, take);
      return rows.map((b) => applySelect(decorateBooking(b), select));
    }),
    count: jest.fn(async ({ where } = {}) => store.bookings.filter((b) => bookingMatch(b, where)).length),
  },
  trainerBookingEvent: {
    create: jest.fn(async ({ data }) => { const row = { id: nid('ev'), createdAt: new Date(), ...data }; store.bookingEvents.push(row); return row; }),
  },
  notification: {
    create: jest.fn(async ({ data }) => { const row = { id: nid('nt'), read: false, createdAt: new Date(), ...data }; store.notifications.push(row); return row; }),
  },
  auditLog: {
    create: jest.fn(async ({ data }) => { store.audit.push(data); return { id: nid('au'), ...data }; }),
  },
  $transaction: jest.fn((cb) => (typeof cb === 'function' ? cb(mockPrisma) : Promise.all(cb))),
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

// ---------------------------------------------------------------------------
// App under test — same mount points reported for src/routes/index.js
// ---------------------------------------------------------------------------
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');
const scheduling = require('../src/services/schedulingService');

const app = express();
app.use(express.json());
app.use('/trainer/schedule', require('../src/routes/trainerSchedule'));
app.use('/me', require('../src/routes/myBookings'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const setFlag = (key, value) => { process.env[envOverrideName(key)] = value; flags.resetCache(); };
const asTrainer = (req) => req.set('x-user-id', TRAINER_USER);
const asClient = (req) => req.set('x-user-id', CLIENT);

function seedSessionType(overrides = {}) {
  const row = {
    id: nid('st'), trainerId: TRAINER_ID, name: 'Session', durationMin: 60, mode: 'virtual',
    meetingLink: null, bufferMin: 0, minNoticeMin: 0, cancelWindowMin: 1440, active: true,
    ...overrides,
  };
  store.sessionTypes.push(row);
  return row;
}

function seedBooking(overrides = {}) {
  const st = overrides.sessionTypeId ? store.sessionTypes.find((s) => s.id === overrides.sessionTypeId) : store.sessionTypes[0];
  const start = overrides.startAtUtc || new Date('2027-01-05T15:00:00.000Z');
  const row = {
    id: nid('bk'), relationId: REL_ID, sessionTypeId: st?.id, startAtUtc: start,
    endAtUtc: overrides.endAtUtc || new Date(+start + (st?.durationMin || 60) * 60000),
    status: 'requested', requestedBy: 'client', createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
  store.bookings.push(row);
  return row;
}

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
  setFlag('trainer_dashboard', 'true');
  setFlag('trainer_advanced_features_enabled', 'true'); // class:'control' — not auto-enabled by setup.js
  setFlag('trainer_scheduling_enabled', 'true');
});

afterEach(() => {
  setFlag('trainer_scheduling_enabled', 'true');
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
describe('PUT /trainer/schedule/availability', () => {
  test('replaces all windows and resolves tz fallback from preference/body', async () => {
    const res = await asTrainer(request(app).put('/trainer/schedule/availability'))
      .send({ timeZone: 'America/New_York', windows: [{ weekday: 1, startMin: 540, endMin: 720 }, { weekday: 3, startMin: 600, endMin: 900, timeZone: 'UTC' }] });
    expect(res.status).toBe(200);
    expect(res.body.availability).toHaveLength(2);
    expect(store.prefs.find((p) => p.trainerId === TRAINER_ID).timeZone).toBe('America/New_York');
    expect(store.availability.find((w) => w.weekday === 1).timeZone).toBe('America/New_York'); // pref fallback
    expect(store.availability.find((w) => w.weekday === 3).timeZone).toBe('UTC'); // explicit per-window
  });

  test('validates windows and tz', async () => {
    expect((await asTrainer(request(app).put('/trainer/schedule/availability')).send({ windows: [{ weekday: 7, startMin: 0, endMin: 60 }] })).status).toBe(400);
    expect((await asTrainer(request(app).put('/trainer/schedule/availability')).send({ windows: [{ weekday: 1, startMin: 720, endMin: 540 }] })).status).toBe(400);
    expect((await asTrainer(request(app).put('/trainer/schedule/availability')).send({ windows: [{ weekday: 1, startMin: 0, endMin: 60, timeZone: 'Mars/Olympus' }] })).status).toBe(400);
  });

  test('non-trainer role is rejected', async () => {
    const res = await asClient(request(app).put('/trainer/schedule/availability')).send({ windows: [] });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// computeSlots — pure slot engine incl. DST
// ---------------------------------------------------------------------------
describe('computeSlots', () => {
  const mon9to12 = [{ weekday: 1, startMin: 540, endMin: 720, timeZone: 'America/New_York' }];
  const hour = { durationMin: 60, bufferMin: 0, minNoticeMin: 0 };

  test('weekly window produces one-hour slot starts within range', () => {
    const slots = scheduling.computeSlots({
      availability: mon9to12, bookings: [], sessionType: hour,
      fromUtc: new Date('2025-10-20T00:00:00Z'), toUtc: new Date('2025-10-28T00:00:00Z'),
      nowUtc: new Date('2025-10-01T00:00:00Z'),
    }).map((d) => d.toISOString());
    // Oct 20 and Oct 27 2025 are Mondays; New York still on EDT (UTC-4) → 09:00 local = 13:00Z
    expect(slots).toEqual([
      '2025-10-20T13:00:00.000Z', '2025-10-20T14:00:00.000Z', '2025-10-20T15:00:00.000Z',
      '2025-10-27T13:00:00.000Z', '2025-10-27T14:00:00.000Z', '2025-10-27T15:00:00.000Z',
    ]);
  });

  test('DST fall-back shifts slot UTC starts (America/New_York, Nov 2025)', () => {
    const slots = scheduling.computeSlots({
      availability: mon9to12, bookings: [], sessionType: hour,
      fromUtc: new Date('2025-11-02T00:00:00Z'), toUtc: new Date('2025-11-04T00:00:00Z'),
      nowUtc: new Date('2025-10-01T00:00:00Z'),
    }).map((d) => d.toISOString());
    // Nov 2 2025 02:00 EDT→EST. Monday Nov 3 09:00 local is now UTC-5 → 14:00Z, not 13:00Z.
    expect(slots).toEqual(['2025-11-03T14:00:00.000Z', '2025-11-03T15:00:00.000Z', '2025-11-03T16:00:00.000Z']);
    expect(slots).not.toContain('2025-11-03T13:00:00.000Z');
  });

  test('existing booking + buffer blocks overlapping candidates; minNotice filters', () => {
    const sessionType = { durationMin: 60, bufferMin: 15, minNoticeMin: 120 };
    const slots = scheduling.computeSlots({
      availability: [{ weekday: 1, startMin: 540, endMin: 840, timeZone: 'UTC' }], // 09:00–14:00
      bookings: [{ startAtUtc: new Date('2027-01-04T10:00:00Z'), endAtUtc: new Date('2027-01-04T11:00:00Z') }],
      sessionType,
      fromUtc: new Date('2027-01-04T00:00:00Z'), toUtc: new Date('2027-01-05T00:00:00Z'),
      nowUtc: new Date('2027-01-04T07:30:00Z'),
    }).map((d) => d.toISOString());
    // 09:00 dropped by minNotice (07:30+2h=09:30); 10:00 overlaps the booking;
    // 09:00 and 11:00 are adjacent to it and blocked by the 15-min buffer —
    // buffer is a required gap on BOTH sides of an existing booking.
    expect(slots).toEqual(['2027-01-04T12:00:00.000Z', '2027-01-04T13:00:00.000Z']);
  });
});

// ---------------------------------------------------------------------------
// Booking request → respond lifecycle
// ---------------------------------------------------------------------------
describe('booking lifecycle', () => {
  const START = '2027-01-05T15:00:00.000Z';

  test('request → confirm creates booking, event and notifications', async () => {
    const st = seedSessionType();
    const req = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START, clientNote: 'please focus on mobility' });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('requested');
    expect(req.body.requestedBy).toBe('client');
    expect(req.body.endAtUtc).toBe('2027-01-05T16:00:00.000Z');
    expect(store.notifications.some((n) => n.userId === TRAINER_USER && n.type === 'trainer.booking_requested')).toBe(true);
    expect(store.bookingEvents.some((e) => e.bookingId === req.body.id && e.action === 'requested')).toBe(true);

    const res = await asTrainer(request(app).post(`/trainer/schedule/bookings/${req.body.id}/respond`)).send({ action: 'confirm' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(store.notifications.some((n) => n.userId === CLIENT && n.type === 'trainer.booking_responded')).toBe(true);
  });

  test('double-booking prevented: second request on same slot → 409 SLOT_TAKEN', async () => {
    const st = seedSessionType();
    const first = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START });
    expect(first.status).toBe(201);

    // 'requested' itself blocks — a second request for the same slot fails.
    const dupe = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('SLOT_TAKEN');

    await asTrainer(request(app).post(`/trainer/schedule/bookings/${first.body.id}/respond`)).send({ action: 'confirm' });
    // Overlapping (not identical) requests are also rejected.
    const overlap = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: '2027-01-05T15:30:00.000Z' });
    expect(overlap.status).toBe(409);
    // A non-overlapping slot succeeds.
    const ok = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: '2027-01-05T17:00:00.000Z' });
    expect(ok.status).toBe(201);
  });

  test('decline frees the slot', async () => {
    const st = seedSessionType();
    const first = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START });
    const dec = await asTrainer(request(app).post(`/trainer/schedule/bookings/${first.body.id}/respond`)).send({ action: 'decline' });
    expect(dec.body.status).toBe('declined');
    const again = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START });
    expect(again.status).toBe(201);
  });

  test('respond rejects bad action and non-pending states', async () => {
    const st = seedSessionType();
    const b = seedBooking({ sessionTypeId: st.id, status: 'canceled' });
    expect((await asTrainer(request(app).post(`/trainer/schedule/bookings/${b.id}/respond`)).send({ action: 'maybe' })).status).toBe(400);
    expect((await asTrainer(request(app).post(`/trainer/schedule/bookings/${b.id}/respond`)).send({ action: 'confirm' })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Cancel / reschedule / complete
// ---------------------------------------------------------------------------
describe('cancel, reschedule, complete', () => {
  test('client cancel window enforced on confirmed bookings', async () => {
    const st = seedSessionType({ cancelWindowMin: 1440 }); // 24h
    const soon = seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date(Date.now() + 2 * 3600e3) });
    const denied = await asClient(request(app).post(`/me/bookings/${soon.id}/cancel`)).send({});
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('CANCEL_WINDOW');

    const later = seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date(Date.now() + 72 * 3600e3) });
    const ok = await asTrainer(request(app).post(`/trainer/schedule/bookings/${later.id}/cancel`)).send({});
    // ^ trainer cancel of a confirmed booking — always allowed, notifies client
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('canceled');
    expect(store.notifications.some((n) => n.userId === CLIENT && n.type === 'trainer.booking_canceled')).toBe(true);

    const later2 = seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date(Date.now() + 96 * 3600e3) });
    const ok2 = await asClient(request(app).post(`/me/bookings/${later2.id}/cancel`)).send({});
    expect(ok2.status).toBe(200);
    expect(ok2.body.status).toBe('canceled');
  });

  test('requested bookings can be withdrawn by the client anytime', async () => {
    const st = seedSessionType({ cancelWindowMin: 1440 });
    const b = seedBooking({ sessionTypeId: st.id, status: 'requested', startAtUtc: new Date(Date.now() + 3600e3) });
    const res = await asClient(request(app).post(`/me/bookings/${b.id}/cancel`)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
  });

  test('reschedule re-checks overlap and records from/to event', async () => {
    const st = seedSessionType();
    const taken = seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date('2027-02-02T15:00:00Z') });
    const moving = seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date('2027-02-01T15:00:00Z') });

    const clash = await asClient(request(app).post(`/me/bookings/${moving.id}/reschedule`))
      .send({ startAtUtc: '2027-02-02T15:00:00.000Z' });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('SLOT_TAKEN');

    const ok = await asClient(request(app).post(`/me/bookings/${moving.id}/reschedule`))
      .send({ startAtUtc: '2027-02-03T18:00:00.000Z' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('rescheduled');
    expect(ok.body.startAtUtc).toBe('2027-02-03T18:00:00.000Z');
    const ev = store.bookingEvents.find((e) => e.bookingId === moving.id && e.action === 'rescheduled');
    expect(ev.fromStart.toISOString()).toBe('2027-02-01T15:00:00.000Z');
    expect(ev.toStart.toISOString()).toBe('2027-02-03T18:00:00.000Z');
    expect(taken.status).toBe('confirmed'); // untouched

    // rescheduled bookings can be re-confirmed by the trainer
    const res = await asTrainer(request(app).post(`/trainer/schedule/bookings/${moving.id}/respond`)).send({ action: 'confirm' });
    expect(res.body.status).toBe('confirmed');
  });

  test('markCompleted: past confirmed → completed', async () => {
    const st = seedSessionType();
    const past = seedBooking({
      sessionTypeId: st.id, status: 'confirmed',
      startAtUtc: new Date(Date.now() - 3 * 3600e3), endAtUtc: new Date(Date.now() - 2 * 3600e3),
    });
    const res = await asTrainer(request(app).post(`/trainer/schedule/bookings/${past.id}/complete`)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');

    const future = seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date(Date.now() + 48 * 3600e3) });
    expect((await asTrainer(request(app).post(`/trainer/schedule/bookings/${future.id}/complete`)).send({})).status).toBe(409);
  });

  test('lists: /me/bookings for client, /trainer/schedule/bookings with filters', async () => {
    const st = seedSessionType();
    seedBooking({ sessionTypeId: st.id, status: 'confirmed', startAtUtc: new Date('2027-03-01T15:00:00Z') });
    seedBooking({ sessionTypeId: st.id, status: 'requested', startAtUtc: new Date('2027-03-02T15:00:00Z') });
    const mine = await asClient(request(app).get('/me/bookings'));
    expect(mine.status).toBe(200);
    expect(mine.body.bookings).toHaveLength(2);
    const filtered = await asTrainer(request(app).get('/trainer/schedule/bookings?status=requested&from=2027-03-01'));
    expect(filtered.status).toBe(200);
    expect(filtered.body.bookings).toHaveLength(1);
    expect(filtered.body.bookings[0].status).toBe('requested');
  });
});

// ---------------------------------------------------------------------------
// Cross-relation / access control
// ---------------------------------------------------------------------------
describe('access control', () => {
  const START = '2027-01-05T15:00:00.000Z';

  test('non-participant cannot book on someone else\'s relation', async () => {
    const st = seedSessionType();
    const res = await request(app).post('/me/bookings').set('x-user-id', OTHER_CLIENT)
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START });
    expect(res.status).toBe(403);
  });

  test('inactive (dropped) relation cannot book', async () => {
    const st = seedSessionType();
    const res = await request(app).post('/me/bookings').set('x-user-id', OTHER_CLIENT)
      .send({ relationId: 'rel-dropped', sessionTypeId: st.id, startAtUtc: START });
    expect(res.status).toBe(403);
  });

  test('sessionType of another trainer is rejected', async () => {
    const st = seedSessionType({ trainerId: 'tp-2' });
    const res = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: START });
    expect(res.status).toBe(400);
  });

  test('min-notice enforced on request', async () => {
    const st = seedSessionType({ minNoticeMin: 1440 });
    const res = await asClient(request(app).post('/me/bookings'))
      .send({ relationId: REL_ID, sessionTypeId: st.id, startAtUtc: new Date(Date.now() + 3600e3).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MIN_NOTICE');
  });
});

// ---------------------------------------------------------------------------
// Available slots endpoint
// ---------------------------------------------------------------------------
describe('GET /me/available-slots', () => {
  test('returns computed UTC slot starts for an active relation', async () => {
    store.availability.push({ id: 'av-1', trainerId: TRAINER_ID, weekday: 1, startMin: 540, endMin: 720, timeZone: 'UTC' });
    const st = seedSessionType({ durationMin: 60 });
    // 2027-01-04 is a Monday.
    const res = await asClient(request(app).get('/me/available-slots'))
      .query({ trainerId: TRAINER_ID, from: '2027-01-04T00:00:00Z', to: '2027-01-05T00:00:00Z', sessionTypeId: st.id });
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual(['2027-01-04T09:00:00.000Z', '2027-01-04T10:00:00.000Z', '2027-01-04T11:00:00.000Z']);
  });

  test('client without an active relation is rejected', async () => {
    const st = seedSessionType();
    const res = await request(app).get('/me/available-slots').set('x-user-id', OTHER_CLIENT)
      .query({ trainerId: TRAINER_ID, from: '2027-01-04T00:00:00Z', to: '2027-01-05T00:00:00Z', sessionTypeId: st.id });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Feature flag gate
// ---------------------------------------------------------------------------
describe('flag-off', () => {
  test('trainer_scheduling_enabled=false → 403 FEATURE_DISABLED everywhere', async () => {
    setFlag('trainer_scheduling_enabled', 'false');
    const mine = await asClient(request(app).get('/me/bookings'));
    expect(mine.status).toBe(403);
    expect(mine.body.error.code).toBe('FEATURE_DISABLED');
    const sched = await asTrainer(request(app).put('/trainer/schedule/availability')).send({ windows: [] });
    expect(sched.status).toBe(403);
    expect(sched.body.error.code).toBe('FEATURE_DISABLED');
  });

  test('parent flag off cascades to scheduling', async () => {
    setFlag('trainer_advanced_features_enabled', 'false');
    const res = await asClient(request(app).get('/me/bookings'));
    expect(res.status).toBe(403);
    setFlag('trainer_advanced_features_enabled', 'true');
  });
});

// ---------------------------------------------------------------------------
// tz helpers
// ---------------------------------------------------------------------------
describe('tz helpers', () => {
  test('isValidTimeZone', () => {
    expect(scheduling.isValidTimeZone('America/New_York')).toBe(true);
    expect(scheduling.isValidTimeZone('UTC')).toBe(true);
    expect(scheduling.isValidTimeZone('Not/AZone')).toBe(false);
    expect(scheduling.isValidTimeZone(42)).toBe(false);
  });

  test('zonedTimeToUtcMs converts local wall-clock across the Nov transition', () => {
    const before = scheduling.zonedTimeToUtcMs('America/New_York', 2025, 10, 27, 540); // Oct 27 09:00 EDT
    const after = scheduling.zonedTimeToUtcMs('America/New_York', 2025, 11, 3, 540);  // Nov 3 09:00 EST
    expect(new Date(before).toISOString()).toBe('2025-10-27T13:00:00.000Z');
    expect(new Date(after).toISOString()).toBe('2025-11-03T14:00:00.000Z');
  });
});

// Trainer↔client messaging: HTTP routes over an in-memory Prisma mock.
// Flag bypass pattern mirrors tests/featureFlags.route.test.js.
const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');

const setFlag = (key, value) => { process.env[envOverrideName(key)] = value; flags.resetCache(); };

const app = express();
app.use(express.json());
app.use('/conversations', require('../src/routes/conversations'));
app.use('/me/push-tokens', require('../src/routes/pushTokens'));

const TRAINER_USER = 'trainer-user';
const TRAINER_ID = 'tp-1';
const CLIENT = 'client-user';
const OTHER = 'other-user';
const RELATION_ID = 'rel-1';

// --- tiny in-memory Prisma subset -------------------------------------------
function matchWhere(row, where) {
  return Object.entries(where || {}).every(([key, cond]) => {
    if (key === 'OR') return cond.some((w) => matchWhere(row, w));
    if (key === 'AND') return cond.every((w) => matchWhere(row, w));
    if (cond === null) return row[key] == null;
    if (cond && typeof cond === 'object') {
      const ops = ['in', 'not', 'gt', 'gte', 'lt', 'lte'];
      if (ops.some((op) => op in cond)) {
        if ('in' in cond && !cond.in.includes(row[key])) return false;
        if ('not' in cond && row[key] === cond.not) return false;
        if ('gt' in cond && !(row[key] > cond.gt)) return false;
        if ('gte' in cond && !(row[key] >= cond.gte)) return false;
        if ('lt' in cond && !(row[key] < cond.lt)) return false;
        if ('lte' in cond && !(row[key] <= cond.lte)) return false;
        return true;
      }
      return row[key] != null && typeof row[key] === 'object' && matchWhere(row[key], cond);
    }
    return row[key] === cond;
  });
}

function applySelect(obj, select) {
  if (!select) return obj;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, obj[k]]));
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const spec of keys) {
      const [[field, dir]] = Object.entries(spec);
      const mul = dir === 'desc' ? -1 : 1;
      if (a[field] > b[field]) return mul;
      if (a[field] < b[field]) return -mul;
    }
    return 0;
  });
}

function seedDb({ status = 'active' } = {}) {
  const state = {
    trainers: [{ id: TRAINER_ID, userId: TRAINER_USER, verified: true, active: true, applicationStatus: 'approved', displayName: 'Coach K', profilePicture: null }],
    relations: [{ id: RELATION_ID, trainerId: TRAINER_ID, clientId: CLIENT, status }],
    conversations: [],
    messages: [],
    audit: [],
    notifications: [],
    pushTokens: [],
  };
  let seq = 0;
  const nextId = (p) => `${p}${String(++seq).padStart(4, '0')}`;
  const now = () => new Date();
  const relationView = (rel) => (rel ? { ...rel, trainer: { ...(state.trainers.find((t) => t.id === rel.trainerId) || {}) } } : null);
  const convView = (c) => ({ ...c, relation: relationView(state.relations.find((r) => r.id === c.relationId)) });
  const attachConv = (c, include) => {
    const out = { ...c };
    if (include && include.relation) {
      const rel = relationView(state.relations.find((r) => r.id === c.relationId));
      out.relation = rel && include.relation.include && include.relation.include.trainer
        ? { ...rel, trainer: applySelect(rel.trainer, include.relation.include.trainer.select) }
        : rel;
    }
    if (include && include.messages) {
      const spec = include.messages;
      let rows = state.messages.filter((m) => m.conversationId === c.id && matchWhere(m, spec.where));
      rows = sortRows(rows, spec.orderBy);
      if (spec.take) rows = rows.slice(0, spec.take);
      out.messages = rows;
    }
    return out;
  };

  const prisma = {
    trainerProfile: {
      findUnique: jest.fn(async ({ where }) => state.trainers.find((t) => t.userId === where.userId || t.id === where.id) || null),
    },
    trainerClient: {
      findUnique: jest.fn(async ({ where, include }) => {
        let rel = null;
        if (where.id) rel = state.relations.find((r) => r.id === where.id) || null;
        else if (where.trainerId_clientId) rel = state.relations.find((r) => r.trainerId === where.trainerId_clientId.trainerId && r.clientId === where.trainerId_clientId.clientId) || null;
        if (!rel) return null;
        if (include && include.trainer) return { ...rel, trainer: applySelect(state.trainers.find((t) => t.id === rel.trainerId), include.trainer.select) };
        return rel;
      }),
    },
    conversation: {
      findUnique: jest.fn(async ({ where, include }) => {
        const c = state.conversations.find((x) => (where.id && x.id === where.id) || (where.relationId && x.relationId === where.relationId)) || null;
        return c && include ? attachConv(c, include) : c;
      }),
      findMany: jest.fn(async ({ where, include, orderBy, select } = {}) => {
        let rows = state.conversations.map(convView).filter((v) => matchWhere(v, where));
        rows = sortRows(rows, orderBy);
        return rows.map((v) => (select ? applySelect(v, select) : attachConv(v, include)));
      }),
      create: jest.fn(async ({ data }) => {
        if (state.conversations.some((c) => c.relationId === data.relationId)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = { id: nextId('conv-'), relationId: data.relationId, createdAt: now(), updatedAt: now() };
        state.conversations.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const c = state.conversations.find((x) => x.id === where.id);
        if (!c) throw new Error('Conversation not found');
        Object.assign(c, data);
        return c;
      }),
    },
    message: {
      create: jest.fn(async ({ data }) => {
        const row = { id: nextId('msg-'), conversationId: data.conversationId, senderId: data.senderId, body: data.body, readAt: null, deletedAt: null, createdAt: now() };
        state.messages.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where } = {}) =>
        state.messages.find((m) => m.id === (where && where.id)) || null),
      findMany: jest.fn(async ({ where, orderBy, take } = {}) => {
        let rows = state.messages.filter((m) => matchWhere(m, where));
        rows = sortRows(rows, orderBy);
        if (take) rows = rows.slice(0, take);
        return rows;
      }),
      count: jest.fn(async ({ where } = {}) => state.messages.filter((m) => matchWhere(m, where)).length),
      groupBy: jest.fn(async ({ where, by } = {}) => {
        const groups = new Map();
        for (const m of state.messages.filter((x) => matchWhere(x, where))) {
          const key = m[by[0]];
          groups.set(key, (groups.get(key) || 0) + 1);
        }
        return [...groups.entries()].map(([conversationId, n]) => ({ conversationId, _count: { _all: n } }));
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const m of state.messages) {
          if (matchWhere(m, where)) { Object.assign(m, data); count += 1; }
        }
        return { count };
      }),
    },
    notification: {
      create: jest.fn(async ({ data }) => {
        const row = { id: nextId('ntf-'), read: false, createdAt: now(), ...data };
        state.notifications.push(row);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        const row = { id: nextId('aud-'), createdAt: now(), ...data };
        state.audit.push(row);
        return row;
      }),
    },
    devicePushToken: {
      findMany: jest.fn(async ({ where } = {}) => state.pushTokens.filter((t) => matchWhere(t, where))),
      upsert: jest.fn(async ({ where, update, create }) => {
        const existing = state.pushTokens.find((t) => t.token === where.token);
        if (existing) { Object.assign(existing, update, { updatedAt: now() }); return existing; }
        const row = { id: nextId('tok-'), createdAt: now(), updatedAt: now(), ...create };
        state.pushTokens.push(row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }) => {
        const before = state.pushTokens.length;
        state.pushTokens = state.pushTokens.filter((t) => !matchWhere(t, where));
        return { count: before - state.pushTokens.length };
      }),
    },
  };
  getPrisma.mockReturnValue(prisma);
  return state;
}

async function sendAs(user, convId, body) {
  return request(app).post(`/conversations/${convId}/messages`).set('x-user-id', user).send({ body });
}

beforeEach(() => {
  jest.clearAllMocks();
  setFlag('trainer_messaging_enabled', 'true');
});

beforeAll(() => setFlag('trainer_advanced_features_enabled', 'true'));
afterAll(() => { delete process.env[envOverrideName('trainer_advanced_features_enabled')]; flags.resetCache(); });

describe('conversation creation', () => {
  test('trainer starts a conversation; repeat call is idempotent', async () => {
    seedDb();
    const res = await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER);
    expect(res.status).toBe(201);
    expect(res.body.conversation.relationId).toBe(RELATION_ID);
    const again = await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER);
    expect(again.status).toBe(200);
    expect(again.body.conversation.id).toBe(res.body.conversation.id);
  });

  test('client starts via trainer profile id; requires active relation', async () => {
    seedDb();
    const res = await request(app).post(`/conversations/with-trainer/${TRAINER_ID}`).set('x-user-id', CLIENT);
    expect(res.status).toBe(201);
    seedDb({ status: 'pending' });
    const denied = await request(app).post(`/conversations/with-trainer/${TRAINER_ID}`).set('x-user-id', CLIENT);
    expect(denied.status).toBe(403);
  });

  test('non-trainer cannot start a conversation with a client', async () => {
    seedDb();
    const res = await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', OTHER);
    expect(res.status).toBe(403);
  });
});

describe('send / read / unread', () => {
  test('send message, recipient sees unread + lastMessage, mark-read clears', async () => {
    seedDb();
    const created = await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER);
    const convId = created.body.conversation.id;

    const sent = await sendAs(CLIENT, convId, '  hello coach  ');
    expect(sent.status).toBe(201);
    expect(sent.body.message.body).toBe('hello coach');
    expect(sent.body.message.senderId).toBe(CLIENT);

    const unread = await request(app).get('/conversations/unread-count').set('x-user-id', TRAINER_USER);
    expect(unread.body).toEqual({ count: 1 });
    expect((await request(app).get('/conversations/unread-count').set('x-user-id', CLIENT)).body.count).toBe(0);

    const list = await request(app).get('/conversations').set('x-user-id', TRAINER_USER);
    expect(list.status).toBe(200);
    expect(list.body.conversations).toHaveLength(1);
    expect(list.body.conversations[0].unreadCount).toBe(1);
    expect(list.body.conversations[0].lastMessage.body).toBe('hello coach');
    expect(list.body.conversations[0].trainer.displayName).toBe('Coach K');

    const read = await request(app).post(`/conversations/${convId}/read`).set('x-user-id', TRAINER_USER).send({ lastMessageId: sent.body.message.id });
    expect(read.body).toEqual({ markedRead: 1 });
    expect((await request(app).get('/conversations/unread-count').set('x-user-id', TRAINER_USER)).body.count).toBe(0);
  });

  test('history paginates by id cursor', async () => {
    seedDb();
    const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
    for (const body of ['one', 'two', 'three']) await sendAs(TRAINER_USER, convId, body);

    const page1 = await request(app).get(`/conversations/${convId}/messages?limit=2`).set('x-user-id', CLIENT);
    expect(page1.status).toBe(200);
    expect(page1.body.messages.map((m) => m.body)).toEqual(['one', 'two']);
    expect(page1.body.nextCursor).toBe(page1.body.messages[1].id);

    const page2 = await request(app).get(`/conversations/${convId}/messages?after=${page1.body.nextCursor}`).set('x-user-id', CLIENT);
    expect(page2.body.messages.map((m) => m.body)).toEqual(['three']);
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe('authorization', () => {
  test('non-participant cannot read, send, mark-read, or report', async () => {
    seedDb();
    const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
    await sendAs(CLIENT, convId, 'private');
    expect((await request(app).get(`/conversations/${convId}/messages`).set('x-user-id', OTHER)).status).toBe(403);
    expect((await sendAs(OTHER, convId, 'intrusion')).status).toBe(403);
    expect((await request(app).post(`/conversations/${convId}/read`).set('x-user-id', OTHER).send({ lastMessageId: 'x' })).status).toBe(403);
    expect((await request(app).post(`/conversations/${convId}/report`).set('x-user-id', OTHER)).status).toBe(403);
    expect((await request(app).get('/conversations').set('x-user-id', OTHER)).body.conversations).toEqual([]);
    expect((await request(app).get('/conversations/unread-count').set('x-user-id', OTHER)).body.count).toBe(0);
  });

  test('missing identity is rejected', async () => {
    seedDb();
    expect((await request(app).get('/conversations')).status).toBe(401);
  });
});

describe('ended relation archive', () => {
  test('sends blocked with 403 but history stays readable for both parties', async () => {
    const state = seedDb();
    const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
    await sendAs(TRAINER_USER, convId, 'before the end');

    state.relations[0].status = 'dropped';
    const blocked = await sendAs(TRAINER_USER, convId, 'still there?');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('Coaching relationship ended.');
    expect((await sendAs(CLIENT, convId, 'me too')).status).toBe(403);

    for (const user of [TRAINER_USER, CLIENT]) {
      const res = await request(app).get(`/conversations/${convId}/messages`).set('x-user-id', user);
      expect(res.status).toBe(200);
      expect(res.body.messages.map((m) => m.body)).toEqual(['before the end']);
    }
    const list = await request(app).get('/conversations').set('x-user-id', CLIENT);
    expect(list.body.conversations[0].relationStatus).toBe('dropped');
  });
});

describe('validation + flags', () => {
  test('body over 4000 chars or empty is rejected', async () => {
    seedDb();
    const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
    expect((await sendAs(CLIENT, convId, 'x'.repeat(4001))).status).toBe(400);
    expect((await sendAs(CLIENT, convId, 'x'.repeat(4000))).status).toBe(201);
    expect((await sendAs(CLIENT, convId, '   ')).status).toBe(400);
    expect((await sendAs(CLIENT, convId, undefined)).status).toBe(400);
  });

  test('trainer_messaging_enabled off => 403 FEATURE_DISABLED', async () => {
    seedDb();
    setFlag('trainer_messaging_enabled', 'false');
    const res = await request(app).get('/conversations').set('x-user-id', TRAINER_USER);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  test('advanced parent flag off forces messaging off even when child env is true', async () => {
    seedDb();
    setFlag('trainer_advanced_features_enabled', 'false');
    expect((await request(app).get('/conversations').set('x-user-id', TRAINER_USER)).status).toBe(403);
    setFlag('trainer_advanced_features_enabled', 'true');
  });
});

describe('reporting', () => {
  test('report writes message.report audit on Conversation, never the body', async () => {
    const state = seedDb();
    const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
    await sendAs(CLIENT, convId, 'reported secret text');
    const res = await request(app).post(`/conversations/${convId}/report`).set('x-user-id', TRAINER_USER);
    expect(res.status).toBe(200);
    expect(res.body.reported).toBe(true);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe('message.report');
    expect(state.audit[0].entityType).toBe('Conversation');
    expect(state.audit[0].entityId).toBe(convId);
    expect(JSON.stringify(state.audit[0])).not.toMatch('reported secret text');
  });
});

describe('push + inbox notification', () => {
  test('register/delete device token', async () => {
    seedDb();
    const res = await request(app).post('/me/push-tokens').set('x-user-id', TRAINER_USER).send({ token: 'ExponentPushToken[abc]', platform: 'ios' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('ExponentPushToken[abc]');
    expect((await request(app).post('/me/push-tokens').set('x-user-id', TRAINER_USER).send({ token: 'x', platform: 'web' })).status).toBe(400);
    const del = await request(app).delete('/me/push-tokens/ExponentPushToken%5Babc%5D').set('x-user-id', TRAINER_USER);
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
  });

  test('message send notifies recipient via inbox row + generic push (never body text)', async () => {
    const state = seedDb();
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock;
    try {
      await request(app).post('/me/push-tokens').set('x-user-id', TRAINER_USER).send({ token: 'ExponentPushToken[t1]', platform: 'ios' });
      const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
      const sent = await sendAs(CLIENT, convId, 'super secret body');
      expect(sent.status).toBe(201);

      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0]).toMatchObject({ userId: TRAINER_USER, type: 'trainer.message' });
      expect(state.notifications[0].body).not.toMatch('super secret body');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://exp.host/--/api/v2/push/send');
      const payload = JSON.parse(init.body);
      expect(payload).toHaveLength(1);
      expect(payload[0].to).toBe('ExponentPushToken[t1]');
      expect(payload[0].data.conversationId).toBe(convId);
      expect(JSON.stringify(payload)).not.toMatch('super secret body');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('push transport failure never fails the send', async () => {
    const state = seedDb();
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('network down'); });
    try {
      state.pushTokens.push({ id: 'tok-x', userId: TRAINER_USER, token: 'ExponentPushToken[t9]', platform: 'ios' });
      const convId = (await request(app).post(`/conversations/with/${CLIENT}`).set('x-user-id', TRAINER_USER)).body.conversation.id;
      expect((await sendAs(CLIENT, convId, 'still delivered')).status).toBe(201);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

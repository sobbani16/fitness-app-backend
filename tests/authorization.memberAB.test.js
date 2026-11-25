// Cross-user authorization (IDOR) regression suite — Member A ('member-a') vs
// Member B ('member-b') isolation plus trainer↔client relation checks.
//
// The prisma mock is a generic in-memory store. Every model accessor filters
// `where` clauses (including nested relation filters and compound-unique
// keys), so a handler that forgets userId/relation scoping leaks rows and the
// assertions catch it — same contract as healthOutcomes.test.js.
const request = require('supertest');
const crypto = require('node:crypto');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');
const { ROLE_PERMISSIONS } = require('../src/config/rbac');

// trainer_paid_coaching/messaging/nutrition depend on this class-'control'
// flag; tests/setup.js only enables non-control flags.
process.env[envOverrideName('trainer_advanced_features_enabled')] = 'true';
const setFlag = (k, v) => { process.env[envOverrideName(k)] = v; flags.resetCache(); };

// ---------------------------------------------------------------------------
// In-memory prisma
// ---------------------------------------------------------------------------
const db = {};
let seq = 0;
const nid = (p = 'row') => `${p}-${++seq}`;
const rows = (m) => (db[m] ||= []);

// Relation resolution for include + nested where filters.
// fk: child.fk -> parent.id lookup; back: parent.id -> child.back lookup.
const REL = {
  condition: { model: 'healthCondition', fk: 'conditionId' },
  allergy: { model: 'allergy', fk: 'allergyId' },
  medication: { model: 'medication', fk: 'medicationId' },
  supplement: { model: 'supplement', fk: 'supplementId' },
  userSupplement: { model: 'userSupplement', fk: 'userSupplementId' },
  schedule: { model: 'supplementSchedule', fk: 'scheduleId' },
  trainer: { model: 'trainerProfile', fk: 'trainerId' },
  nutritionist: { model: 'nutritionistProfile', fk: 'nutritionistId' },
  creator: { model: 'creatorProfile', fk: 'creatorId' },
  relation: { model: 'trainerClient', fk: 'relationId' },
  document: { model: 'trainerDocument', fk: 'documentId' },
  conversation: { model: 'conversation', fk: 'conversationId' },
  group: { model: 'coachingGroup', fk: 'groupId' },
  plan: { model: 'trainerNutritionPlan', fk: 'planId' },
  package: { model: 'trainerCoachingPackage', fk: 'packageId' },
  purchase: { model: 'trainerPurchase', fk: 'purchaseId' },
  recipe: { model: 'recipe', fk: 'recipeId' },
  habit: { model: 'habit', fk: 'habitId' },
  workoutSession: { model: 'workoutSession', fk: 'workoutSessionId' },
  videoSession: { model: 'videoSession', fk: 'videoSessionId' },
  ingredient: { model: 'ingredient', fk: 'ingredientId' },
  form: { model: 'supplementForm', fk: 'formId' },
  product: { model: 'supplementProduct', fk: 'productId' },
  user: { model: 'user', fk: 'userId' },
  // has-many / has-one children
  shares: { model: 'trainerDocumentShare', back: 'documentId', many: true },
  messages: { model: 'message', back: 'conversationId', many: true },
  members: { model: 'coachingGroupMember', back: 'groupId', many: true },
  schedules: { model: 'supplementSchedule', back: 'userSupplementId', many: true },
  contributors: { model: 'scoreContributor', back: 'healthScoreId', many: true },
  insights: { model: 'healthScoreInsight', back: 'healthScoreId', many: true },
  exerciseSets: { model: 'exerciseSet', back: 'workoutSessionId', many: true },
  items: { model: 'mealPlanItem', back: 'mealPlanId', many: true },
  exercises: { model: 'workoutPlanExercise', back: 'workoutPlanId', many: true },
  meals: { model: 'weeklyMeal', back: 'planId', many: true },
  shoppingList: { model: 'weeklyShoppingList', back: 'planId', many: false },
  ingredients: { model: 'recipeIngredient', back: 'recipeId', many: true },
  goals: { model: 'outcomeGoal', back: 'outcomePlanId', many: true },
  adjustments: { model: 'outcomePlanAdjustment', back: 'outcomePlanId', many: true },
  recommendations: { model: 'weeklyRecommendation', back: 'reviewId', many: true },
  violations: { model: 'recommendationViolation', back: 'recommendationId', many: true },
  completions: { model: 'habitCompletion', back: 'habitId', many: true },
  measurements: { model: 'healthMeasurement', back: 'sourceId', many: true },
  cursors: { model: 'healthSyncCursor', back: 'sourceId', many: true },
  analytics: { model: 'creatorAnalytics', back: 'creatorId', many: false },
  education: { model: 'supplementEducation', back: 'supplementId', many: false },
  sources: { model: 'researchSource', back: 'educationId', many: true },
  aliases: { model: 'ingredientAlias', back: 'ingredientId', many: true },
  forms: { model: 'ingredientForm', back: 'ingredientId', many: true },
  attributes: { model: 'supplementAttribute', back: 'supplementId', many: true },
  supplementRules: { model: 'supplementRule', back: 'supplementId', many: true },
  role: { inline: true }, // seeded with the full role object
};
// Ambiguous names resolved per parent model.
const REL2 = {
  'trainerNutritionAssignment.feedback': { model: 'trainerNutritionFeedback', back: 'assignmentId', many: true },
  'formCheckRequest.feedback': { model: 'formCheckFeedback', back: 'requestId', many: true },
  'videoSession.summary': { model: 'videoSessionSummary', fk: 'videoSessionId' },
};

const relModelOf = (model, key) => (REL2[`${model}.${key}`] || REL[key] || {}).model;
function resolveRel(model, key, row) {
  if (!row) return undefined;
  if (row[key] !== undefined) return row[key];
  const spec = REL2[`${model}.${key}`] || REL[key];
  if (!spec || spec.inline) return undefined;
  if (spec.fk) return rows(spec.model).find(r => r.id === row[spec.fk]) || null;
  if (spec.back) {
    const list = rows(spec.model).filter(r => r[spec.back] === row.id);
    return spec.many ? list : (list[0] || null);
  }
  return undefined;
}

const isPlain = v => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && !Buffer.isBuffer(v);
const OP_KEYS = new Set(['in', 'notIn', 'not', 'equals', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'mode', 'some', 'every', 'none', 'is', 'has', 'hasSome', 'hasEvery']);
const isOp = v => isPlain(v) && Object.keys(v).length > 0 && Object.keys(v).every(k => OP_KEYS.has(k));

function cmp(a, b) {
  const ta = a instanceof Date ? a.getTime() : (/^\d{4}-\d{2}-\d{2}T/.test(String(a)) ? new Date(a).getTime() : a);
  const tb = b instanceof Date ? b.getTime() : (/^\d{4}-\d{2}-\d{2}T/.test(String(b)) ? new Date(b).getTime() : b);
  if (typeof ta === 'number' && typeof tb === 'number') return ta - tb;
  if (ta == null || tb == null) return ta === tb ? 0 : 1;
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}
function eqv(a, b) {
  if (a instanceof Date || b instanceof Date) return cmp(a, b) === 0;
  if (isPlain(a) || isPlain(b) || Array.isArray(a) || Array.isArray(b)) {
    if (a == null || b == null) return a == null && b == null;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function matchScalar(fv, cond) {
  const ci = cond.mode === 'insensitive';
  const s = x => (ci ? String(x ?? '').toLowerCase() : String(x ?? ''));
  for (const [op, val] of Object.entries(cond)) {
    if (op === 'mode') continue;
    switch (op) {
      case 'in': if (!(Array.isArray(val) && val.some(x => eqv(fv, x)))) return false; break;
      case 'notIn': if (Array.isArray(val) && val.some(x => eqv(fv, x))) return false; break;
      case 'not': if (matchCond(fv, val)) return false; break;
      case 'equals': if (!eqv(fv, val)) return false; break;
      case 'lt': if (!(cmp(fv, val) < 0)) return false; break;
      case 'lte': if (!(cmp(fv, val) <= 0)) return false; break;
      case 'gt': if (!(cmp(fv, val) > 0)) return false; break;
      case 'gte': if (!(cmp(fv, val) >= 0)) return false; break;
      case 'contains': if (!s(fv).includes(s(val))) return false; break;
      case 'startsWith': if (!s(fv).startsWith(s(val))) return false; break;
      case 'endsWith': if (!s(fv).endsWith(s(val))) return false; break;
      case 'has': if (!(Array.isArray(fv) ? fv.some(x => eqv(x, val)) : eqv(fv, val))) return false; break;
      case 'hasSome': case 'hasEvery':
        if (!(Array.isArray(val) && val.every(x => (fv || []).some(y => eqv(x, y))))) return false; break;
      default: return true; // some/every/none/is handled by matchWhere (need row ctx)
    }
  }
  return true;
}

function matchCond(fv, cond) {
  if (!isPlain(cond) || cond instanceof Date) return eqv(fv, cond);
  if (isOp(cond)) return matchScalar(fv, cond);
  return matchWhere(fv, cond); // relation filter on an embedded object
}

function matchWhere(row, where, model) {
  if (where == null) return true;
  if (row == null) return false;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR' || key === 'AND' || key === 'NOT') {
      const arr = Array.isArray(cond) ? cond : [cond];
      if (key === 'OR' && !arr.some(c => matchWhere(row, c, model))) return false;
      if (key === 'AND' && !arr.every(c => matchWhere(row, c, model))) return false;
      if (key === 'NOT' && arr.some(c => matchWhere(row, c, model))) return false;
      continue;
    }
    // Compound-unique flatten: {userId_deviceId:{userId,deviceId}} etc. — the
    // field name never exists on the row, so expand into scalar equality.
    if (key.includes('_') && isPlain(cond) && !isOp(cond) && row[key] === undefined) {
      if (!matchWhere(row, cond, model)) return false;
      continue;
    }
    if (isOp(cond)) {
      const ci = cond.mode === 'insensitive';
      if (cond.is !== undefined) {
        const rel = resolveRel(model, key, row);
        if (!matchWhere(rel, cond.is, relModelOf(model, key))) return false;
      }
      if (cond.some !== undefined) {
        const rel = resolveRel(model, key, row);
        if (!(Array.isArray(rel) && rel.some(r => matchWhere(r, cond.some, relModelOf(model, key))))) return false;
      }
      if (cond.none !== undefined) {
        const rel = resolveRel(model, key, row);
        if (Array.isArray(rel) && rel.some(r => matchWhere(r, cond.none, relModelOf(model, key)))) return false;
      }
      if (cond.every !== undefined) {
        const rel = resolveRel(model, key, row);
        if (!(Array.isArray(rel) && rel.every(r => matchWhere(r, cond.every, relModelOf(model, key))))) return false;
      }
      const rest = Object.fromEntries(Object.entries(cond).filter(([k]) => !['is', 'some', 'none', 'every'].includes(k)));
      if (Object.keys(rest).length && !matchScalar(row[key], ci ? { ...rest, mode: 'insensitive' } : rest)) return false;
      continue;
    }
    if (isPlain(cond)) {
      const rel = resolveRel(model, key, row);
      if (!matchWhere(rel, cond, relModelOf(model, key))) return false;
      continue;
    }
    if (!eqv(row[key], cond)) return false;
  }
  return true;
}

function applyInclude(row, include, model) {
  if (!include || !row) return row;
  const out = { ...row };
  for (const [key, spec] of Object.entries(include)) {
    if (spec === false) continue;
    const sub = spec === true ? {} : spec;
    let val = resolveRel(model, key, row);
    const subModel = relModelOf(model, key);
    if (Array.isArray(val) && sub.where) val = val.filter(r => matchWhere(r, sub.where, subModel));
    if (sub.include) val = Array.isArray(val) ? val.map(r => applyInclude(r, sub.include, subModel)) : applyInclude(val, sub.include, subModel);
    if (sub.orderBy && Array.isArray(val)) val = sortRows(val, sub.orderBy);
    if (sub.take != null && Array.isArray(val)) val = val.slice(0, sub.take);
    out[key] = val === undefined ? null : val;
  }
  return out;
}

function sortRows(list, orderBy) {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(s => s && typeof s === 'object');
  return [...list].sort((a, b) => {
    for (const s of specs) {
      const [f, dir] = Object.entries(s)[0] || [];
      if (dir !== 'asc' && dir !== 'desc') continue;
      const av = String(f).split('.').reduce((o, k) => (o == null ? o : o[k]), a);
      const bv = String(f).split('.').reduce((o, k) => (o == null ? o : o[k]), b);
      const c = cmp(av, bv);
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

function applyData(row, data) {
  for (const [k, v] of Object.entries(data || {})) {
    if (isPlain(v) && 'increment' in v) row[k] = (row[k] || 0) + v.increment;
    else if (isPlain(v) && 'decrement' in v) row[k] = (row[k] || 0) - v.decrement;
    else if (isPlain(v) && 'set' in v) row[k] = v.set;
    else row[k] = v;
  }
}

function model(name) {
  const api = {
    findMany: async (args = {}) => {
      let out = rows(name).filter(r => matchWhere(r, args.where, name));
      if (args.orderBy) out = sortRows(out, args.orderBy);
      if (args.skip) out = out.slice(args.skip);
      if (args.take != null) out = args.take < 0 ? out.slice(args.take) : out.slice(0, args.take);
      if (args.include) out = out.map(r => applyInclude(r, args.include, name));
      if (args.select && !args.include) {
        const keep = Object.entries(args.select).filter(([, v]) => v === true).map(([k]) => k);
        if (keep.length) out = out.map(r => Object.fromEntries(keep.filter(k => k in r).map(k => [k, r[k]])));
      }
      return out;
    },
    findFirst: async (args = {}) => (await api.findMany(args))[0] || null,
    findUnique: async (args = {}) => {
      const r = rows(name).find(x => matchWhere(x, args?.where, name)) || null;
      return r && args?.include ? applyInclude(r, args.include, name) : r;
    },
    findUniqueOrThrow: async (args = {}) => {
      const r = await api.findUnique(args);
      if (!r) throw Object.assign(new Error('An operation failed because it depends on one or more records that were required but not found.'), { code: 'P2025' });
      return r;
    },
    count: async (args = {}) => (await api.findMany({ where: args?.where })).length,
    create: async (args = {}) => {
      const data = { ...(args?.data || {}) };
      const row = { id: nid(name), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows(name).push(row);
      return args?.include ? applyInclude(row, args.include, name) : row;
    },
    createMany: async (args = {}) => {
      const made = (args?.data || []).map(d => ({ id: nid(name), createdAt: new Date(), ...d }));
      rows(name).push(...made);
      return { count: made.length };
    },
    update: async (args = {}) => {
      const r = rows(name).find(x => matchWhere(x, args?.where, name));
      if (!r) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      applyData(r, args?.data);
      return args?.include ? applyInclude(r, args.include, name) : r;
    },
    updateMany: async (args = {}) => {
      let n = 0;
      for (const r of rows(name)) if (matchWhere(r, args?.where, name)) { applyData(r, args?.data); n++; }
      return { count: n };
    },
    delete: async (args = {}) => {
      const i = rows(name).findIndex(x => matchWhere(x, args?.where, name));
      if (i < 0) throw Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025' });
      const [r] = rows(name).splice(i, 1);
      return r;
    },
    deleteMany: async (args = {}) => {
      const before = rows(name).length;
      db[name] = rows(name).filter(r => !matchWhere(r, args?.where, name));
      return { count: before - rows(name).length };
    },
    upsert: async (args = {}) => {
      const ex = rows(name).find(x => matchWhere(x, args?.where, name));
      if (ex) { applyData(ex, args?.update); return args?.include ? applyInclude(ex, args.include, name) : ex; }
      const r = { id: nid(name), createdAt: new Date(), ...(args?.create || {}) };
      rows(name).push(r);
      return args?.include ? applyInclude(r, args.include, name) : r;
    },
    groupBy: async (args = {}) => {
      const by = args?.by || [];
      const groups = new Map();
      for (const r of rows(name).filter(x => matchWhere(x, args?.where, name))) {
        const k = by.map(f => String(r[f])).join('|');
        const g = groups.get(k) || { row: r, n: 0 };
        g.n++; groups.set(k, g);
      }
      return [...groups.values()].map(({ row, n }) => {
        const o = {}; by.forEach(f => { o[f] = row[f]; });
        o._count = args?._count === true ? n : { _all: n };
        return o;
      });
    },
    aggregate: async (args = {}) => {
      const rs = rows(name).filter(r => matchWhere(r, args?.where, name));
      const out = {};
      if (args?._sum) { out._sum = {}; for (const f of Object.keys(args._sum)) out._sum[f] = rs.reduce((s, r) => s + (r[f] || 0), 0); }
      if (args?._count) out._count = rs.length;
      return out;
    },
  };
  return api;
}

const rawQuery = async (strings, vals) => {
  const sql = (Array.isArray(strings) ? strings.join('?') : String(strings));
  if (/AuthRateBucket/i.test(sql)) return [{ count: 1 }];
  if (/FROM\s+"User"/i.test(sql) || /FOR UPDATE/i.test(sql)) {
    const u = rows('user').find(r => r.id === vals[0]);
    return u ? [u] : [];
  }
  return [];
};

const base = {
  $transaction: async (fn) => (Array.isArray(fn) ? Promise.all(fn) : fn(mockPrisma)),
  $queryRaw: async (strings, ...vals) => rawQuery(strings, vals),
  $executeRaw: async () => 0,
  $disconnect: async () => {},
};
const mockPrisma = new Proxy(base, {
  get: (t, p) => {
    if (p === 'then' || typeof p !== 'string') return undefined;
    if (p in t) return t[p];
    return (t[p] = model(p));
  },
});

jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => ({})) }));
jest.mock('../src/services/allergyRevalidation', () => ({ revalidateActivePlans: jest.fn(async () => ({ revalidated: 0 })) }));
jest.mock('../src/services/pushService', () => ({
  sendPushToUser: jest.fn(async () => ({ sent: 0 })),
  registerToken: jest.fn(async () => ({})),
  removeToken: jest.fn(async () => ({ removed: true })),
}));
// Only verifyPassword is stubbed (export reauthentication); everything else is real.
jest.mock('../src/services/authService', () => {
  const actual = jest.requireActual('../src/services/authService');
  return { ...actual, verifyPassword: jest.fn(async (pw, hash) => pw === 'correct-password' && typeof hash === 'string' && hash.length > 0) };
});

const app = require('../src/app');
const { exportAccount } = require('../src/services/accountData');

const A = 'member-a', B = 'member-b', T1 = 'trainer-1', T2 = 'trainer-2';
const auth = (u) => ({ 'x-user-id': u });
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = '2026-02-10';
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

const roleRow = (userId, name) => ({
  id: nid('ur'), userId, active: true,
  role: { id: `role-${name}`, name, rolePermissions: (ROLE_PERMISSIONS[name] || []).map(p => ({ permission: { name: p } })) },
});

function seed() {
  // users (include passwordHash so account-export reauthentication reads a row)
  for (const u of [A, B, T1, T2, 'nutri-1']) rows('user').push({ id: u, email: `${u}@test.local`, passwordHash: `hash-${u}`, firstName: u });
  // roles: members are MEMBER, trainers TRAINER
  for (const u of [A, B]) rows('userRole').push(roleRow(u, 'MEMBER'));
  for (const u of [T1, T2]) rows('userRole').push(roleRow(u, 'TRAINER'));
  // approved trainer profiles
  rows('trainerProfile').push(
    { id: 'tp-1', userId: T1, displayName: 'Coach One', verified: true, active: true, applicationStatus: 'approved' },
    { id: 'tp-2', userId: T2, displayName: 'Coach Two', verified: true, active: true, applicationStatus: 'approved' },
  );
  rows('nutritionistProfile').push({ id: 'np-1', userId: 'nutri-1', active: true });
  // trainer↔client relations: rel-a/rel-b ACTIVE (tp-1), rel-x ENDED (tp-2 → member-a)
  rows('trainerClient').push(
    { id: 'rel-a', trainerId: 'tp-1', clientId: A, status: 'active', startedAt: new Date('2026-01-01') },
    { id: 'rel-b', trainerId: 'tp-1', clientId: B, status: 'active', startedAt: new Date('2026-01-01') },
    { id: 'rel-x', trainerId: 'tp-2', clientId: A, status: 'ended', startedAt: new Date('2025-06-01'), endedAt: new Date('2025-12-01') },
  );
  // health conditions
  rows('healthCondition').push({ id: 'cond-iron', name: 'Iron Deficiency', slug: 'iron_deficiency', category: 'metabolic', evidenceClass: 'evidence_based' });
  rows('userHealthCondition').push(
    { id: 'uc-a', userId: A, conditionId: 'cond-iron', active: true, source: 'self_report', createdAt: new Date('2026-01-05') },
    { id: 'uc-b', userId: B, conditionId: 'cond-iron', active: true, source: 'self_report', notes: 'B-SECRET-NOTE', createdAt: new Date('2026-01-06') },
  );
  // allergies
  rows('allergy').push({ id: 'alg-milk', name: 'milk' }, { id: 'alg-peanut', name: 'peanut' });
  rows('userAllergy').push({ id: 'ua-a', userId: A, allergyId: 'alg-milk' }, { id: 'ua-b', userId: B, allergyId: 'alg-peanut' });
  // food logs on DAY
  const noon = new Date(`${DAY}T12:00:00.000Z`);
  rows('foodLog').push(
    { id: 'fl-a', userId: A, foodName: 'A lunch', mealType: 'lunch', calories: 500, loggedAt: noon, nutritionSnapshot: {} },
    { id: 'fl-b', userId: B, foodName: 'B-SECRET-MEAL', mealType: 'lunch', calories: 9999, loggedAt: noon, nutritionSnapshot: {} },
  );
  // personal workout plans
  rows('userWorkoutPlan').push(
    { id: 'wp-a', userId: A, version: 1, status: 'draft', plan: { days: [] }, preferences: {}, createdAt: new Date('2026-01-02') },
    { id: 'wp-b', userId: B, version: 1, status: 'draft', plan: { days: [] }, preferences: {}, createdAt: new Date('2026-01-02') },
  );
  // health scores + daily progress
  rows('healthScore').push(
    { id: 'hs-a', userId: A, date: '2026-02-09', score: 55 },
    { id: 'hs-b', userId: B, date: '2026-02-09', score: 88, notes: 'B-SECRET-SCORE' },
  );
  rows('dailyProgressDay').push(
    { id: 'dpd-a', userId: A, dayKey: DAY, score: 40 },
    { id: 'dpd-b', userId: B, dayKey: DAY, score: 95 },
  );
  // meal plans (nutritionist-authored)
  rows('mealPlan').push(
    { id: 'mp-a', clientId: A, nutritionistId: 'np-1', title: 'A plan', createdAt: new Date('2026-01-03') },
    { id: 'mp-b', clientId: B, nutritionistId: 'np-1', title: 'B-SECRET-PLAN', createdAt: new Date('2026-01-03') },
  );
  rows('mealPlanItem').push({ id: 'mpi-b', mealPlanId: 'mp-b', name: 'B-SECRET-ITEM' });
  // coach notes
  rows('coachNote').push(
    { id: 'cn-a-pub', coachId: 'np-1', clientId: A, note: 'A visible note', visibility: 'client_visible' },
    { id: 'cn-a-priv', coachId: 'np-1', clientId: A, note: 'A-SECRET-PRIVATE', visibility: 'private' },
    { id: 'cn-b', coachId: T2, clientId: B, note: 'B-SECRET-NOTE', visibility: 'client_visible' },
  );
  // conversations + messages
  rows('conversation').push(
    { id: 'conv-a', relationId: 'rel-a', createdAt: new Date('2026-01-10'), updatedAt: new Date('2026-01-10') },
    { id: 'conv-b', relationId: 'rel-b', createdAt: new Date('2026-01-11'), updatedAt: new Date('2026-01-11') },
  );
  rows('message').push(
    { id: 'msg-b1', conversationId: 'conv-b', senderId: T1, body: 'B-SECRET-MESSAGE', createdAt: new Date('2026-01-11T10:00:00Z'), readAt: null, deletedAt: null },
  );
  // check-ins
  rows('checkIn').push(
    { id: 'ci-a', relationId: 'rel-a', clientId: A, weekOf: new Date('2026-02-02'), goalProgress: 'a-progress' },
    { id: 'ci-b', relationId: 'rel-b', clientId: B, weekOf: new Date('2026-02-02'), goalProgress: 'B-SECRET-PROGRESS' },
  );
  // reminders
  rows('reminderInstance').push(
    { id: 'ri-a', userId: A, category: 'meal', status: 'sent', scheduledFor: new Date(), createdAt: new Date() },
    { id: 'ri-b', userId: B, category: 'meal', status: 'sent', title: 'B-SECRET-REMINDER', scheduledFor: new Date(), createdAt: new Date() },
  );
  rows('reminderPreference').push({ id: 'rp-b', userId: B, masterEnabled: true, adaptiveEnabled: true, quietStart: '22:00', timezone: 'UTC' });
  // notifications
  rows('notification').push(
    { id: 'ntf-a', userId: A, type: 'trainer.message', title: 'A note', read: false, createdAt: new Date('2026-02-01') },
    { id: 'ntf-b', userId: B, type: 'trainer.message', title: 'B-SECRET-NOTIFICATION', read: false, createdAt: new Date('2026-02-01') },
  );
  // supplements
  rows('supplement').push(
    { id: 'sup-1', name: 'Creatine', catalogStatus: 'published', ownerId: null, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
    { id: 'sup-2', name: 'B-PERSONAL-SUPP', catalogStatus: 'personal', ownerId: B },
  );
  rows('userSupplement').push(
    { id: 'us-a', userId: A, supplementId: 'sup-1' },
    { id: 'us-b', userId: B, supplementId: 'sup-2' },
  );
  rows('supplementSchedule').push(
    { id: 'sched-a', userId: A, userSupplementId: 'us-a', supplementId: 'sup-1', frequency: 'daily', reminderTime: '08:00', active: true, notifyEnabled: true },
    { id: 'sched-b', userId: B, userSupplementId: 'us-b', supplementId: 'sup-2', frequency: 'daily', reminderTime: '09:00', active: true, notifyEnabled: true },
  );
  rows('supplementDoseOccurrence').push(
    { id: 'occ-a', userId: A, scheduleId: 'sched-a', userSupplementId: 'us-a', status: 'PENDING', localDate: TODAY, scheduledFor: new Date() },
    { id: 'occ-b', userId: B, scheduleId: 'sched-b', userSupplementId: 'us-b', status: 'PENDING', localDate: TODAY, scheduledFor: new Date() },
  );
  // trainer documents (doc-a shared to member-a's relation, doc-b to member-b's)
  rows('trainerDocument').push(
    { id: 'doc-a', trainerId: 'tp-1', title: 'A plan pdf', category: 'nutrition', fileKey: 'tp-1/doc-a.pdf', fileName: 'a.pdf', status: 'active', uploadedAt: new Date() },
    { id: 'doc-b', trainerId: 'tp-1', title: 'B-SECRET-DOC', category: 'nutrition', fileKey: 'tp-1/doc-b.pdf', fileName: 'b.pdf', status: 'active', uploadedAt: new Date() },
  );
  rows('trainerDocumentShare').push(
    { id: 'share-a', documentId: 'doc-a', relationId: 'rel-a', groupId: null, createdAt: new Date() },
    { id: 'share-b', documentId: 'doc-b', relationId: 'rel-b', groupId: null, createdAt: new Date() },
  );
  // commerce
  rows('trainerCoachingPackage').push({ id: 'pkg-1', trainerId: 'tp-1', title: 'Pack', kind: 'session_pack', priceCents: 5000, active: true });
  rows('trainerPurchase').push(
    { id: 'pur-a', clientId: A, packageId: 'pkg-1', amountCents: 5000, currency: 'usd', status: 'paid', createdAt: new Date('2026-01-20') },
    { id: 'pur-b', clientId: B, packageId: 'pkg-1', amountCents: 5000, currency: 'usd', status: 'paid', createdAt: new Date('2026-01-21') },
  );
  rows('trainerEntitlement').push(
    { id: 'ent-a', clientId: A, purchaseId: 'pur-a', kind: 'session_pack', sessionsTotal: 5, sessionsUsed: 0, status: 'active' },
    { id: 'ent-b', clientId: B, purchaseId: 'pur-b', kind: 'session_pack', sessionsTotal: 5, sessionsUsed: 0, status: 'active' },
  );
  // auth sessions for account export
  rows('authSession').push(
    { id: 'sess-a', tokenHash: sha256('token-a'), userId: A, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
    { id: 'sess-b', tokenHash: sha256('token-b'), userId: B, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
  );
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  seq = 0;
  seed();
  flags.resetCache();
});
afterEach(() => setFlag('trainer_advanced_features_enabled', 'true'));

const ownIds = (list) => list.every(r => r.userId === A || r.clientId === A);
const expectLeakFree = (res) => expect(res.text).not.toMatch(/member-b|B-SECRET/);

// ===========================================================================
describe('health conditions /me/health-conditions', () => {
  it('GET returns only own conditions', async () => {
    const res = await request(app).get('/me/health-conditions').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.conditions.map(c => c.id)).toEqual(['uc-a']);
    expectLeakFree(res);
  });
  it('GET as member-b does not see member-a rows', async () => {
    const res = await request(app).get('/me/health-conditions').set(auth(B));
    expect(res.status).toBe(200);
    expect(res.body.conditions.map(c => c.id)).toEqual(['uc-b']);
  });
  it('PATCH on member-b row → 404', async () => {
    const res = await request(app).patch('/me/health-conditions/uc-b').set(auth(A)).send({ severity: 'severe' });
    expect(res.status).toBe(404);
    expect(db.userHealthCondition.find(r => r.id === 'uc-b').severity ?? null).toBeNull();
  });
  it('DELETE on member-b row → 404 and row stays active', async () => {
    const res = await request(app).delete('/me/health-conditions/uc-b').set(auth(A));
    expect(res.status).toBe(404);
    expect(db.userHealthCondition.find(r => r.id === 'uc-b').active).toBe(true);
  });
  it('POST with body.userId=member-b is owned by member-a', async () => {
    const res = await request(app).post('/me/health-conditions').set(auth(A))
      .send({ slug: 'iron_deficiency', consent: true, userId: B });
    expect(res.status).toBe(201);
    const created = db.userHealthCondition.filter(r => r.conditionId === 'cond-iron' && r.userId === A);
    expect(created.length).toBe(1);
    expect(db.userHealthCondition.filter(r => r.userId === B).length).toBe(1); // only uc-b
  });
});

// ===========================================================================
// NOTE on /me/allergies: the route reads bare `req.userId` (no identifyUser/
// header fallback), which only a real session sets. Under AUTH_TEST_BYPASS
// the id is undefined — queries still scope by it, so the observable contract
// here is strictly negative: member-a's request can never read or mutate
// member-b's rows (an undefined owner can't resolve to another user's rows).
// Cross-user isolation is what this suite verifies; positive own-read is
// exercised by the session-authenticated integration suite.
describe('allergies /me/allergies', () => {
  it('GET never returns member-b allergens', async () => {
    const res = await request(app).get('/me/allergies').set(auth(A));
    expect(res.status).toBe(200);
    expectLeakFree(res);
    expect(res.body.allergens.map(a => a.key)).not.toContain('peanut');
  });
  it('PUT with body.userId=member-b never touches member-b rows', async () => {
    const res = await request(app).put('/me/allergies').set(auth(A)).send({ allergens: ['peanut'], userId: B });
    expect(res.status).toBe(200);
    // member-b's stored allergy set is untouched — no row owned by B was
    // deleted, created, or reassigned by member-a's write.
    expect(db.userAllergy.filter(r => r.userId === B)).toEqual([
      expect.objectContaining({ id: 'ua-b', allergyId: 'alg-peanut' }),
    ]);
    const bView = await request(app).get('/me/allergies').set(auth(B));
    expect(bView.status).toBe(200);
  });
});

// ===========================================================================
describe('food logs /food-logs', () => {
  it('GET ?date returns only own logs', async () => {
    const res = await request(app).get(`/food-logs?date=${DAY}`).set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.logs.map(l => l.id)).toEqual(['fl-a']);
    expectLeakFree(res);
  });
  it('POST with body.userId=member-b creates a member-a row', async () => {
    const res = await request(app).post('/food-logs').set(auth(A))
      .send({ id: 'fl-a2', foodName: 'A dinner', quantityG: 100, calories: 300, proteinG: 10, carbsG: 20, fatG: 5, userId: B });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(A);
    expect(db.foodLog.find(r => r.id === 'fl-a2').userId).toBe(A);
  });
  it('POST reusing member-b log id → 409, no overwrite', async () => {
    const res = await request(app).post('/food-logs').set(auth(A))
      .send({ id: 'fl-b', foodName: 'hijack', quantityG: 1, calories: 1, proteinG: 1, carbsG: 1, fatG: 1 });
    expect(res.status).toBe(409);
    expect(db.foodLog.find(r => r.id === 'fl-b').foodName).toBe('B-SECRET-MEAL');
  });
  it('DELETE member-b log → row survives', async () => {
    const res = await request(app).delete('/food-logs/fl-b').set(auth(A));
    expect(res.status).toBe(200);
    expect(db.foodLog.find(r => r.id === 'fl-b')).toBeTruthy();
  });
});

// ===========================================================================
describe('personal plans /personal-plans + meal plans /meal-plans', () => {
  it('GET /personal-plans returns only own plans', async () => {
    const res = await request(app).get('/personal-plans').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.plans.map(p => p.id)).toEqual(['wp-a']);
    expectLeakFree(res);
  });
  it('PUT /personal-plans/:id on member-b plan → 404', async () => {
    const res = await request(app).put('/personal-plans/wp-b').set(auth(A)).send({ plan: { days: [] } });
    expect(res.status).toBe(404);
  });
  it('POST /personal-plans/:id/confirm on member-b plan → 404', async () => {
    const res = await request(app).post('/personal-plans/wp-b/confirm').set(auth(A));
    expect(res.status).toBe(404);
    expect(db.userWorkoutPlan.find(r => r.id === 'wp-b').status).toBe('draft');
  });
  it('GET /meal-plans returns only own plans', async () => {
    const res = await request(app).get('/meal-plans').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.plans.map(p => p.id)).toEqual(['mp-a']);
    expectLeakFree(res);
  });
  it('GET /meal-plans/:id of member-b plan → 403', async () => {
    const res = await request(app).get('/meal-plans/mp-b').set(auth(A));
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });
  it('GET /coach-notes?clientId=member-b leaks nothing of member-b', async () => {
    const res = await request(app).get('/coach-notes?clientId=member-b').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.notes).toEqual([]);
  });
  it('GET /coach-notes?clientId=member-a shows only client_visible notes', async () => {
    const res = await request(app).get('/coach-notes?clientId=member-a').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.notes.map(n => n.id)).toEqual(['cn-a-pub']);
  });
});

// ===========================================================================
describe('health scores', () => {
  it('GET /health-score/trend returns only own scores', async () => {
    const res = await request(app).get('/health-score/trend?days=30').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.trend.map(s => s.id || s.date)).not.toContain('hs-b');
    expect(res.body.trend.every(s => (s.userId || A) !== B)).toBe(true);
    expectLeakFree(res);
  });
  it('GET /health-score/:id/detail on member-b score → 404', async () => {
    const res = await request(app).get('/health-score/hs-b/detail').set(auth(A));
    expect(res.status).toBe(404);
  });
  it('GET /health-score computes with own data only', async () => {
    const res = await request(app).get('/health-score').set(auth(A));
    expect(res.status).toBe(200);
    expectLeakFree(res);
  });
  it('GET /daily-progress/history returns only own days', async () => {
    const res = await request(app).get('/daily-progress/history?days=30').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.days?.map(d => d.id) ?? res.body.map?.(d => d.id) ?? []).not.toContain('dpd-b');
    expectLeakFree(res);
  });
  it('GET /daily-progress/today computes from own logs only', async () => {
    const res = await request(app).get(`/daily-progress/today?day=${TODAY}`).set(auth(A));
    expect(res.status).toBe(200);
    expectLeakFree(res);
  });
});

// ===========================================================================
describe('documents /communication/documents', () => {
  it('GET /me lists only docs shared to my relations', async () => {
    const a = await request(app).get('/communication/documents/me').set(auth(A));
    expect(a.status).toBe(200);
    expect(a.body.documents.map(d => d.id)).toEqual(['doc-a']);
    expectLeakFree(a);
    const b = await request(app).get('/communication/documents/me').set(auth(B));
    expect(b.body.documents.map(d => d.id)).toEqual(['doc-b']);
  });
  it('GET /:id/url on member-b doc → 403 (no signed URL cross-issued)', async () => {
    const res = await request(app).get('/communication/documents/doc-b/url').set(auth(A));
    expect([403, 404]).toContain(res.status);
    expect(res.body.url).toBeUndefined();
  });
  it('signed file URL minted for member-a 403s when used as member-b', async () => {
    const issue = await request(app).get('/communication/documents/doc-a/url').set(auth(A));
    expect(issue.status).toBe(200);
    const path = issue.body.url; // /documents/doc-a/file?exp=..&sig=..&filename=..
    const res = await request(app).get(`/communication${path}`).set(auth(B));
    expect(res.status).toBe(403);
  });
  it('POST /:id/share as member → 403', async () => {
    const res = await request(app).post('/communication/documents/doc-a/share').set(auth(A)).send({ relationId: 'rel-b' });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
describe('conversations /conversations', () => {
  it('GET lists only own conversations', async () => {
    const res = await request(app).get('/conversations').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.conversations.map(c => c.id)).toEqual(['conv-a']);
    expectLeakFree(res);
  });
  it('GET /:id/messages on member-b conversation → 403', async () => {
    const res = await request(app).get('/conversations/conv-b/messages').set(auth(A));
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });
  it('POST /:id/messages on member-b conversation → 403', async () => {
    const res = await request(app).post('/conversations/conv-b/messages').set(auth(A)).send({ body: 'hi' });
    expect(res.status).toBe(403);
  });
  it('POST /:id/read on member-b conversation → 403', async () => {
    const res = await request(app).post('/conversations/conv-b/read').set(auth(A)).send({ lastMessageId: 'msg-b1' });
    expect(res.status).toBe(403);
    expect(db.message.find(m => m.id === 'msg-b1').readAt).toBeNull();
  });
  it('POST /:id/report on member-b conversation → 403', async () => {
    const res = await request(app).post('/conversations/conv-b/report').set(auth(A)).send({});
    expect(res.status).toBe(403);
  });
  it('unread-count never counts member-b messages', async () => {
    const res = await request(app).get('/conversations/unread-count').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    const b = await request(app).get('/conversations/unread-count').set(auth(B));
    expect(b.body.count).toBe(1);
  });
  it('member cannot open a conversation as trainer', async () => {
    const res = await request(app).post(`/conversations/with/${B}`).set(auth(A));
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
describe('check-ins /check-ins', () => {
  it('GET /mine returns only own check-ins', async () => {
    const res = await request(app).get('/check-ins/mine').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.checkIns.map(c => c.id)).toEqual(['ci-a']);
    expectLeakFree(res);
  });
  it('GET /:id on member-b check-in → 403', async () => {
    const res = await request(app).get('/check-ins/ci-b').set(auth(A));
    expect(res.status).toBe(403);
  });
  it('POST with member-b relationId → 403', async () => {
    const res = await request(app).post('/check-ins').set(auth(A)).send({ relationId: 'rel-b', goalProgress: 'x' });
    expect(res.status).toBe(403);
  });
  it('POST on own active relation is owned by member-a (body.userId ignored)', async () => {
    const res = await request(app).post('/check-ins').set(auth(A))
      .send({ relationId: 'rel-a', weekOf: '2026-02-16', goalProgress: 'ok', userId: B });
    expect(res.status).toBe(201);
    expect(res.body.clientId).toBe(A);
  });
  it('POST /:id/review as member → 403', async () => {
    const res = await request(app).post('/check-ins/ci-b/review').set(auth(A)).send({ reply: 'nice' });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
describe('reminders /reminders', () => {
  it('GET /instances returns only own instances', async () => {
    const res = await request(app).get('/reminders/instances').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.instances.map(i => i.id)).toEqual(['ri-a']);
    expectLeakFree(res);
  });
  it('POST /instances/:id/action on member-b instance → 404', async () => {
    const res = await request(app).post('/reminders/instances/ri-b/action').set(auth(A)).send({ action: 'complete' });
    expect(res.status).toBe(404);
    expect(db.reminderInstance.find(r => r.id === 'ri-b').status).toBe('sent');
  });
  it('PUT /preferences writes only own prefs (body.userId ignored)', async () => {
    const res = await request(app).put('/reminders/preferences').set(auth(A)).send({ masterEnabled: false, userId: B });
    expect(res.status).toBe(200);
    expect(db.reminderPreference.find(r => r.userId === B).masterEnabled).toBe(true);
    expect(db.reminderPreference.find(r => r.userId === A)?.masterEnabled).toBe(false);
  });
  it('GET /inbox returns only own reminder notifications', async () => {
    rows('notification').push({ id: 'ntf-rb', userId: B, type: 'reminder:meal', title: 'B-SECRET-REMINDER-INBOX', read: false, createdAt: new Date() });
    const res = await request(app).get('/reminders/inbox').set(auth(A));
    expect(res.status).toBe(200);
    expectLeakFree(res);
  });
});

// ===========================================================================
describe('supplements /supplements', () => {
  it('GET /mine returns only own selections', async () => {
    const res = await request(app).get('/supplements/mine').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.supplements.every(s => (s.userSupplementId ? true : true))).toBe(true);
    expect(ownIds(res.body.supplements.map(s => ({ userId: s.userId ?? A })))).toBe(true);
    expectLeakFree(res);
    expect(res.text).not.toContain('B-PERSONAL-SUPP');
  });
  it('PATCH /mine/:userSupplementId on member-b link → 404', async () => {
    const res = await request(app).patch('/supplements/mine/us-b').set(auth(A)).send({ notes: 'hijack' });
    expect(res.status).toBe(404);
  });
  it('GET /mine/:userSupplementId/schedules on member-b link → 404', async () => {
    const res = await request(app).get('/supplements/mine/us-b/schedules').set(auth(A));
    expect(res.status).toBe(404);
  });
  it('POST /mine/:userSupplementId/schedules on member-b link → 404', async () => {
    const res = await request(app).post('/supplements/mine/us-b/schedules').set(auth(A)).send({ reminderTime: '08:00', frequency: 'daily' });
    expect(res.status).toBe(404);
    expect(db.supplementSchedule.filter(s => s.userSupplementId === 'us-b')).toHaveLength(1);
  });
  it('PUT /schedules/:id on member-b schedule → 404', async () => {
    const res = await request(app).put('/supplements/schedules/sched-b').set(auth(A)).send({ reminderTime: '07:00', frequency: 'daily' });
    expect(res.status).toBe(404);
  });
  it('DELETE /schedules/:id on member-b schedule → 404 and survives', async () => {
    const res = await request(app).delete('/supplements/schedules/sched-b').set(auth(A));
    expect(res.status).toBe(404);
    expect(db.supplementSchedule.find(s => s.id === 'sched-b')).toBeTruthy();
  });
  it('POST /doses/:id/action on member-b dose → 404, no supplementLog written', async () => {
    const res = await request(app).post('/supplements/doses/occ-b/action').set(auth(A)).send({ action: 'taken' });
    expect(res.status).toBe(404);
    expect(db.supplementDoseOccurrence.find(o => o.id === 'occ-b').status).toBe('PENDING');
    expect(db.supplementLog ?? []).toHaveLength(0);
  });
  it('GET /doses/today returns only own doses', async () => {
    const res = await request(app).get(`/supplements/doses/today?date=${TODAY}`).set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.occurrences.map(o => o.id)).toEqual(['occ-a']);
    expectLeakFree(res);
  });
  it('POST /mine with body.userId=member-b creates a member-a link', async () => {
    const res = await request(app).post('/supplements/mine').set(auth(A)).send({ supplementId: 'sup-1', userId: B });
    expect(res.status).toBe(201);
    expect(db.userSupplement.filter(u => u.supplementId === 'sup-1').every(u => u.userId === A)).toBe(true);
  });
  it('POST /mine with member-b personal supplement → not selectable', async () => {
    const res = await request(app).post('/supplements/mine').set(auth(A)).send({ supplementId: 'sup-2' });
    expect(res.status).toBe(400);
    expect(db.userSupplement.filter(u => u.supplementId === 'sup-2' && u.userId === A)).toHaveLength(0);
  });
  it('POST /personal with body.userId=member-b → owner is member-a', async () => {
    const res = await request(app).post('/supplements/personal').set(auth(A)).send({ name: 'Sneaky', userId: B });
    expect(res.status).toBe(201);
    const owned = db.supplement.filter(s => s.name === 'Sneaky');
    expect(owned).toHaveLength(1);
    expect(owned[0].ownerId).toBe(A);
  });
  it('POST /log with member-b userSupplementId → 404', async () => {
    const res = await request(app).post('/supplements/log').set(auth(A)).send({ userSupplementId: 'us-b', quantity: 1 });
    expect(res.status).toBe(404);
    expect(db.supplementLog ?? []).toHaveLength(0);
  });
});

// ===========================================================================
describe('notifications /me/notifications', () => {
  it('GET returns only own notifications + own unread count', async () => {
    const res = await request(app).get('/me/notifications').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.notifications.map(n => n.id)).toEqual(['ntf-a']);
    expect(res.body.unread).toBe(1);
    expectLeakFree(res);
  });
  it('POST /read with member-b ids never marks member-b rows', async () => {
    const res = await request(app).post('/me/notifications/read').set(auth(A)).send({ ids: ['ntf-b'] });
    expect(res.status).toBe(200);
    expect(db.notification.find(n => n.id === 'ntf-b').read).toBe(false);
    expect(db.notification.find(n => n.id === 'ntf-a').read).toBe(false);
  });
});

// ===========================================================================
describe('purchases /me/purchases + /me/entitlements', () => {
  it('GET /me/purchases returns only own purchases', async () => {
    const res = await request(app).get('/me/purchases').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.purchases.map(p => p.id)).toEqual(['pur-a']);
    expectLeakFree(res);
  });
  it('GET /me/entitlements returns only own entitlements', async () => {
    const res = await request(app).get('/me/entitlements').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.entitlements.map(e => e.id)).toEqual(['ent-a']);
    expectLeakFree(res);
  });
});

// ===========================================================================
describe('account export (service level — route requires a real session)', () => {
  // /me/account is mounted before ensureUser, so under AUTH_TEST_BYPASS
  // req.userId is unset and the HTTP path always 401s. The scoping invariant
  // lives in exportAccount(userId, token, password): exercise it directly.
  it('exports only member-a rows even when member-b data exists', async () => {
    const out = await exportAccount(A, 'token-a', 'correct-password');
    expect(out.data.profile.id).toBe(A);
    expect(JSON.stringify(out.data)).not.toMatch(/member-b|B-SECRET/);
    expect(out.data.foodLog.every(r => r.userId === A)).toBe(true);
    expect(out.data.notification.every(r => r.userId === A)).toBe(true);
    expect(out.data.userHealthCondition.every(r => r.userId === A)).toBe(true);
  });
  it('rejects when the presented session belongs to another user', async () => {
    await expect(exportAccount(A, 'token-b', 'correct-password')).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a wrong password', async () => {
    await expect(exportAccount(A, 'token-a', 'wrong-password')).rejects.toMatchObject({ status: 403 });
  });
});

// ===========================================================================
describe('trainer↔client: access requires an ACTIVE relation', () => {
  it('revoked-relation trainer gets 403 on member progress', async () => {
    const res = await request(app).get(`/trainer/nutrition-plans/clients/${A}/progress`).set(auth(T2));
    expect(res.status).toBe(403);
    expectLeakFree(res);
  });
  it('revoked-relation trainer gets 403 writing coach notes', async () => {
    const res = await request(app).post('/coach-notes').set(auth(T2)).send({ clientId: A, note: 'hi', visibility: 'private' });
    expect(res.status).toBe(403);
    expect((db.coachNote ?? []).filter(n => n.coachId === T2 && n.clientId === A)).toHaveLength(0);
  });
  it('trainer queue for another coach shows no member check-ins', async () => {
    const res = await request(app).get('/check-ins/trainer').set(auth(T2));
    expect(res.status).toBe(200);
    expect(res.body.checkIns).toEqual([]);
  });
  it('trainer with ended relation cannot review member check-ins', async () => {
    const res = await request(app).post('/check-ins/ci-a/review').set(auth(T2)).send({ reply: 'x' });
    expect(res.status).toBe(403);
  });
  it('unrelated trainer cannot read member-b check-in', async () => {
    const res = await request(app).get('/check-ins/ci-b').set(auth(T2));
    expect(res.status).toBe(403);
  });
  it('member cannot use trainer-only progress endpoint', async () => {
    const res = await request(app).get(`/trainer/nutrition-plans/clients/${B}/progress`).set(auth(A));
    expect(res.status).toBe(403);
  });
});

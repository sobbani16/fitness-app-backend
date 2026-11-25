// Leo tool registry — versioned tools with a declared risk class.
// userId/sessionId come from SERVER CONTEXT ONLY: model-supplied args can
// never inject identity or bypass confirmation policy.
const { httpError } = require('../../lib/errors');
const confirmations = require('./confirmations');

const CATEGORIES = Object.freeze({
  READ: 'read_only',
  REVERSIBLE: 'reversible_mutation',
  SENSITIVE: 'sensitive_confirm',
  DESTRUCTIVE: 'destructive_confirm',
  PROHIBITED: 'prohibited',
});
const REQUIRES_CONFIRMATION = new Set([CATEGORIES.SENSITIVE, CATEGORIES.DESTRUCTIVE]);

// Identity keys the model may never supply.
const FORBIDDEN_ARGS = new Set(['userId', 'sessionId', 'user_id', 'session_id', 'confirmationId']);

const registry = new Map(); // `${name}@${version}` -> tool

/** Register a tool. schema: { field: { type:'string'|'number'|'boolean'|'array'|'object', required, enum, max } } */
function register(tool) {
  const version = String(tool.version || '1');
  if (!tool?.name || !Object.values(CATEGORIES).includes(tool.category) || typeof tool.handler !== 'function') {
    throw httpError(400, 'tool requires name, valid category, handler');
  }
  registry.set(`${tool.name}@${version}`, { timeoutMs: 15000, ...tool, version });
}

const get = (name, version = '1') => registry.get(`${name}@${version}`) || null;
const list = () => [...registry.values()].map(({ handler, ...meta }) => meta);

function validate(schema = {}, args = {}) {
  for (const [field, rule] of Object.entries(schema)) {
    const v = args[field];
    if (v === undefined || v === null) {
      if (rule.required) throw httpError(400, `missing required arg: ${field}`);
      continue;
    }
    const t = Array.isArray(v) ? 'array' : typeof v;
    if (rule.type && t !== rule.type) throw httpError(400, `arg ${field}: expected ${rule.type}`);
    if (rule.enum && !rule.enum.includes(v)) throw httpError(400, `arg ${field}: not an allowed value`);
    if (rule.max != null && ((typeof v === 'number' && v > rule.max) || (typeof v === 'string' && v.length > rule.max))) {
      throw httpError(400, `arg ${field}: exceeds limit`);
    }
  }
}

/**
 * Execute a tool. ctx = { userId, sessionId, confirmationId? } — server-side.
 * Destructive/sensitive categories require a consumed confirmation bound to
 * THIS user, session, tool and exact args before the handler runs.
 */
async function execute(name, args = {}, ctx = {}, { version = '1' } = {}) {
  const tool = get(name, version);
  if (!tool) throw httpError(404, `unknown tool: ${name}@${version}`);
  if (tool.category === CATEGORIES.PROHIBITED) throw httpError(403, 'tool_prohibited');
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw httpError(400, 'args must be an object');
  const injected = Object.keys(args).filter((k) => FORBIDDEN_ARGS.has(k));
  if (injected.length) throw httpError(400, `identity args are server-bound: ${injected.join(',')}`);
  validate(tool.inputSchema, args);
  if (!ctx.userId || !ctx.sessionId) throw httpError(401, 'tool requires an authenticated session');

  if (REQUIRES_CONFIRMATION.has(tool.category)) {
    if (!ctx.confirmationId) {
      throw Object.assign(httpError(428, 'confirmation_required'), { code: 'confirmation_required', tool: name });
    }
    await confirmations.consume(ctx.userId, ctx.sessionId, ctx.confirmationId, name, args);
  }
  const result = await Promise.race([
    tool.handler({ ...args }, { userId: ctx.userId, sessionId: ctx.sessionId }),
    new Promise((_, reject) => setTimeout(() => reject(httpError(504, 'tool_timeout')), tool.timeoutMs)),
  ]);
  // post-mutation hooks: mutations (sensitive/destructive) can invalidate
  // dependent state — hook failures never fail the tool call itself
  if (REQUIRES_CONFIRMATION.has(tool.category)) {
    for (const hook of mutationHooks) {
      try { await hook({ tool: name, userId: ctx.userId, sessionId: ctx.sessionId, result }); } catch {}
    }
  }
  return { tool: `${name}@${version}`, status: 'ok', result };
}

const mutationHooks = [];
function registerMutationHook(fn) { if (typeof fn === 'function') mutationHooks.push(fn); }

module.exports = { register, get, list, execute, registerMutationHook, CATEGORIES, REQUIRES_CONFIRMATION };

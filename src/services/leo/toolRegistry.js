// Leo tool registry — dependency-aware execution ordering for multi-intent
// commands. The model proposes intents; the backend executes. Mutations are
// verified persisted before dependent queries/recommendations may run, and a
// failed or unverified write suppresses its dependents — a dependent answer
// must never describe state the write never created.
const TOOL_TYPES = new Set(['mutation', 'query', 'recommendation']);

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(name, spec) {
    if (!spec || !TOOL_TYPES.has(spec.type)) throw new Error(`tool ${name}: type must be mutation|query|recommendation`);
    if (typeof spec.handler !== 'function') throw new Error(`tool ${name}: handler required`);
    this.tools.set(name, {
      type: spec.type,
      handler: spec.handler,
      dependsOnWrites: spec.dependsOnWrites !== false && spec.type !== 'mutation',
    });
    return this;
  }

  has(name) { return this.tools.has(name); }

  // Execute actions in dependency order: mutations first (input order preserved
  // within a class), then queries, then recommendations. `verifyWrites` re-reads
  // created entities; dependents run only when every write in the command is
  // verified persisted. Returns { results, writes: {total, verified, failed} }.
  async executeOrdered(actions, ctx = {}) {
    const rank = a => {
      const t = this.tools.get(a.tool || a.intent)?.type;
      return t === 'mutation' ? 0 : t === 'recommendation' ? 2 : 1;
    };
    const ordered = [...actions].sort((x, y) => rank(x) - rank(y));
    const results = [];
    const writes = { total: 0, verified: 0, failed: 0 };
    const writeErrors = [];
    for (const a of ordered) {
      const spec = this.tools.get(a.tool || a.intent);
      if (!spec) { results.push({ intent: a.intent, status: 'skipped', reason: 'unsupported intent' }); continue; }
      if (spec.type !== 'mutation' && spec.dependsOnWrites && writes.total > 0 && writes.verified < writes.total) {
        results.push({
          intent: a.intent, status: 'suppressed',
          reason: 'dependent write failed or could not be verified — result would describe unverified state',
        });
        continue;
      }
      let out;
      try {
        out = await spec.handler(a, ctx);
      } catch (e) {
        out = { status: 'error', reason: 'handler error' };
      }
      if (spec.type === 'mutation') {
        writes.total += 1;
        const createdIds = (out && out.createdIds) || [];
        let ok = out && out.status === 'saved' && createdIds.length > 0;
        if (ok && typeof ctx.verifyCreated === 'function') {
          ok = await ctx.verifyCreated(createdIds).catch(() => false);
        }
        if (ok) writes.verified += 1;
        else { writes.failed += 1; writeErrors.push({ intent: a.intent, reason: out?.reason || 'unverified write' }); }
        results.push({ intent: a.intent, status: ok ? 'saved' : (out?.status === 'saved' ? 'unverified' : (out?.status || 'skipped')), reason: out?.reason, detail: ok ? out?.detail : undefined });
      } else {
        results.push({ intent: a.intent, status: out?.status || 'answered', detail: out?.detail, data: out?.data });
      }
    }
    return { results, writes, writeErrors };
  }
}

module.exports = { ToolRegistry };

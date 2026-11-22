#!/usr/bin/env node
// Shadow-mode comparison job — for each user, recomputes the activity-safety
// decision LIVE (APPROVED rules only) vs SHADOW (all rules incl. DRAFT) and
// reports where unreviewed rules would have changed the outcome. Shadow rows
// are persisted with shadow=true so the comparison is auditable.
//
// Usage:
//   node scripts/activity-safety-shadow-diff.js --user=<id>
//   node scripts/activity-safety-shadow-diff.js --recent=<n>   # users with
//     recent ActivitySafetyEvaluation rows
//   node scripts/activity-safety-shadow-diff.js --users=<id,id,...> --json
//
// Privacy: stdout carries IDs + decision codes + rule codes only — never
// injury/restriction/symptom content, reasons, or free text. Clinical detail
// stays in the persisted shadow evaluation rows.
//
// Requires the activity_safety_shadow_mode flag (env FF_ACTIVITY_SAFETY_SHADOW_MODE
// or provider) — shadow evaluation never runs unless explicitly enabled.
const { getPrisma } = require('../src/lib/prisma');
const flags = require('../src/services/featureFlags/service');
const safety = require('../src/services/activitySafety');
const { listActivities } = require('../src/services/activitySafety/activityCatalog');

const arg = (k) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const JSON_OUT = process.argv.includes('--json');

function line(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function shadowForUser(prisma, userId, { persist = false } = {}) {
  const on = await flags.isEnabled('activity_safety_shadow_mode', userId).catch(() => false);
  if (!on) return { userId, skipped: 'flag_off' };

  const ctx = await safety.loadSafetyContext(prisma, userId);
  const liveRules = await safety.loadRules(prisma);                        // APPROVED only
  const shadowRules = await safety.loadRules(prisma, { includeDrafts: true }); // all rows
  const activities = listActivities();
  const now = new Date();

  const deltas = [];
  let persisted = 0;
  for (const a of activities) {
    const live = safety.evaluate(ctx, a, null, { rules: liveRules, now });
    const shadow = safety.evaluate(ctx, a, null, { rules: shadowRules, now });
    const newRules = (shadow.ruleIds || []).filter(id => !(live.ruleIds || []).includes(id));
    if (live.decision !== shadow.decision || newRules.length) {
      deltas.push({ activityId: a.id, live: live.decision, shadow: shadow.decision, draftRulesFired: newRules });
      if (persist) {
        await safety.persistEvaluation(prisma, shadow, ctx, { shadow: true }).then(() => persisted++).catch(() => {});
      }
    }
  }
  return { userId, deltas, persisted, liveRulesCount: liveRules.length, shadowRulesCount: shadowRules.length };
}

async function main() {
  const prisma = getPrisma();
  let userIds = [];
  if (arg('user')) userIds = [arg('user')];
  else if (arg('users')) userIds = arg('users').split(',').map(s => s.trim()).filter(Boolean);
  else if (arg('recent')) {
    const n = Math.min(parseInt(arg('recent'), 10) || 25, 500);
    const rows = await prisma.activitySafetyEvaluation.findMany({
      select: { userId: true }, orderBy: { createdAt: 'desc' }, take: n * 10, distinct: ['userId'],
    }).catch(() => []);
    userIds = [...new Set(rows.map(r => r.userId))].slice(0, n);
  } else {
    console.error('Provide --user=<id>, --users=<csv>, or --recent=<n>.');
    process.exit(2);
  }

  const summary = { users: 0, skipped: 0, deltas: 0, byTransition: {}, draftRuleFires: {}, persisted: 0 };
  for (const userId of userIds) {
    const r = await shadowForUser(prisma, userId, { persist: process.argv.includes('--persist') });
    if (r.skipped) { summary.skipped++; continue; }
    summary.users++;
    summary.persisted += r.persisted || 0;
    for (const d of r.deltas || []) {
      summary.deltas++;
      const t = `${d.live}→${d.shadow}`;
      summary.byTransition[t] = (summary.byTransition[t] || 0) + 1;
      for (const code of d.draftRulesFired) summary.draftRuleFires[code] = (summary.draftRuleFires[code] || 0) + 1;
      if (JSON_OUT) line({ event: 'shadow_diff', userId, activityId: d.activityId, live: d.live, shadow: d.shadow, draftRulesFired: d.draftRulesFired });
    }
  }
  line({ event: 'shadow_diff_summary', ...summary });
  return summary;
}

module.exports = { shadowForUser, main };
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

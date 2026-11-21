// Seed the activity-safety rule registry from rulesData.js.
// Every row is written with reviewStatus 'DRAFT' — clinical review is the
// release gate; nothing here activates a rule for real users.
// Usage: node scripts/seed-activity-safety-rules.js [--apply]
//   default = dry-run (prints what would be written)

const { RULES } = require('../src/services/activitySafety/rulesData');

async function main() {
  const apply = process.argv.includes('--apply');
  const { getPrisma } = require('../src/lib/prisma');
  const prisma = getPrisma();

  let created = 0, updated = 0;
  for (const r of RULES) {
    const data = {
      name: r.name,
      category: r.category,
      description: r.reason,
      appliesTo: r.appliesTo || {},
      exclusion: r.exclusion || {},
      requiredData: r.requiredData || [],
      severity: r.severity || 'info',
      effect: r.effect,
      reason: r.reason,
      evidenceRef: r.evidenceRef,
      evidenceClass: r.evidenceClass,
      missingDataBehavior: 'conservative',
      reviewStatus: 'DRAFT', // hard-pinned — never seed as approved
      version: 1,
      reviewDueAt: null, reviewedBy: null, reviewedAt: null,
    };
    if (!apply) { console.log(`${r.code} [DRAFT] ${r.name} → ${r.effect}`); continue; }
    const existing = await prisma.activitySafetyRule.findUnique({ where: { ruleCode: r.code } });
    if (existing) {
      // Never downgrade an APPROVED rule via seed — only update DRAFT/pending rows.
      if (existing.reviewStatus !== 'DRAFT') {
        console.log(`skip ${r.code} — reviewStatus=${existing.reviewStatus} (seed never touches reviewed rules)`);
        continue;
      }
      await prisma.activitySafetyRule.update({ where: { ruleCode: r.code }, data });
      updated++;
    } else {
      await prisma.activitySafetyRule.create({ data: { ...data, ruleCode: r.code } });
      created++;
    }
  }
  console.log(apply ? `seeded: ${created} created, ${updated} updated (all DRAFT)` : `dry-run: ${RULES.length} rules`);
}

main().catch(e => { console.error(e); process.exit(1); });

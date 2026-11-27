// HUM-42 §5: stale-safety-advice read-path guard.
// Invalidation stamps Recommendation.staleAt and deletes unread notifications.
// This is only safe because ALL persisted-recommendation reads go through the
// helper that filters staleAt: null. This structural test scans the codebase
// and fails if any file outside recommendationSafety.js queries the
// Recommendation model directly — a future bypass would silently serve
// post-invalidation stale advice (the exact harm §5 exists to prevent).
const fs = require('fs');
const path = require('path');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.js') && !e.name.includes('.test.')) yield p;
  }
}

describe('§5 invalidation read-path integrity', () => {
  it('no direct Recommendation-model queries outside the filtering helper', () => {
    const offenders = [];
    for (const file of walk(path.join(__dirname, '..', 'src'))) {
      if (file.includes('recommendationSafety.js')) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (/prisma\.recommendation\.(findMany|findFirst|findUnique|update)\b/.test(src)) {
        offenders.push(path.relative(path.join(__dirname, '..'), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the filtering helper itself excludes stale rows', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/activitySafety/recommendationSafety.js'), 'utf8');
    expect(src).toMatch(/where:\s*\{[^}]*staleAt:\s*null/);
  });

  it('invalidation fires on every mutation route', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/routes/activitySafety.js'), 'utf8');
    const mutations = (src.match(/invalidateSafetyAdvice\(prisma, uid\(req\), '\w+'\)/g) || []);
    // 6 write paths + restriction deletes: symptom/injury report+update+delete, restriction delete
    expect(mutations.length).toBeGreaterThanOrEqual(6);
    const reasons = new Set(mutations.map((m) => m.match(/'(\w+)'/)[1]));
    for (const expected of ['symptom_reported', 'injury_reported', 'injury_deleted', 'symptom_deleted', 'symptom_updated', 'restriction_deleted']) {
      expect(reasons.has(expected)).toBe(true);
    }
  });
});

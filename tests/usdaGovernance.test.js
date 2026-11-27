// pc-HUM-36 — USDA governance structural contract.
// The reviewer workflow + rematerialization pipeline carry non-negotiable
// safety properties; these tests pin them structurally so no future edit can
// silently weaken them.
const fs = require('node:fs');
const path = require('node:path');
const review = fs.readFileSync(path.join(__dirname, '../src/routes/nutritionReview.js'), 'utf8');
const remat = fs.readFileSync(path.join(__dirname, '../scripts/rematerialize-usda-preview.js'), 'utf8');

describe('reviewer workflow contract (src/routes/nutritionReview.js)', () => {
  it('never auto-fills verifiedAt on import paths — only APPROVE sets it', () => {
    expect(review).toMatch(/decision === 'APPROVE'/);
    expect(review.match(/verifiedAt: new Date\(\)/g)).toHaveLength(1); // exactly one write site
  });
  it('optimistic concurrency — writes conditioned on observed state, 409 on race', () => {
    expect(review).toMatch(/where: \{ id: p\.id, verifiedAt: null \}/);
    expect(review).toMatch(/count === 0\) return res\.status\(409\)/);
    expect(review).toMatch(/where: \{ id: p\.id, verifiedAt: p\.verifiedAt \}/);
  });
  it('justification required with minimum length on every decision and revoke', () => {
    expect(review.match(/justification required \(min 10 chars\)/g).length).toBeGreaterThanOrEqual(2);
  });
  it('immutable audit — decisions recorded in AuditLog, never mutated', () => {
    expect(review).toMatch(/audit\.log/);
    expect(review).not.toMatch(/auditLog\.(update|delete|updateMany|deleteMany)/);
  });
  it('double-approve impossible — 409 directs to revoke first', () => {
    expect(review).toMatch(/already verified — use revoke first/);
  });
});

describe('rematerialization never overwrites review decisions (scripts/rematerialize-usda-preview.js)', () => {
  it('upsert update clauses are empty no-ops — existing rows are never mutated', () => {
    const updates = remat.match(/update: \{[^}]*\}/g) || [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u.replace(/\s/g, '')).toBe('update:{}');
  });
  it('verifiedAt never appears in any create or update payload', () => {
    expect(remat).not.toMatch(/verifiedAt:/); // payload-key form — comment references are documentation
  });
  it('dry-run default + transactional batch', () => {
    expect(remat).toMatch(/dry run/);
    expect(remat).toMatch(/\$transaction/);
  });
  it('source association is not verification — provenance recorded, never approval', () => {
    expect(remat).toMatch(/sourceDataset/);
    expect(remat).toMatch(/sourceCitation/);
    expect(remat).not.toMatch(/reviewedBy|approvedBy/);
  });
});

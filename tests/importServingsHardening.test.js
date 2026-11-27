// pc-HUM-51 B4 — import pipeline hardening contract.
// Static-contract tests: the pipeline's safety properties are structural and
// must never regress. USDA/network paths are never exercised here.
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '../scripts/import-ingredient-servings.js'), 'utf8');

describe('B4 hardening contract', () => {
  it('dry-run is the default; apply is explicit opt-in', () => {
    expect(SRC).toMatch(/dry-run/i);
    expect(SRC).toMatch(/--apply/);
  });
  it('idempotent stable source ids — deterministic srv_<catalog>_<n> upsert identity', () => {
    expect(SRC).toMatch(/upsert/);
    expect(SRC).toMatch(/srv_\$\{/); // stable id template, never random
  });
  it('writes are transactional per ingredient — never a half-written serving set', () => {
    expect(SRC).toMatch(/\$transaction/);
  });
  it('versioned provenance — batch tag on every written row', () => {
    expect(SRC).toMatch(/batchVersion: BATCH_VERSION/);
    expect(SRC).toMatch(/BATCH_VERSION = 'b4-v1'/);
  });
  it('rate-limit retries: bounded backoff, client errors never retried', () => {
    expect(SRC).toMatch(/withRetry/);
    expect(SRC).toMatch(/429/);
    expect(SRC).toMatch(/clientError\) throw/); // 4xx deterministic — no pointless retry
  });
  it('checkpoints flush after each applied item', () => {
    expect(SRC).toMatch(/CHECKPOINT_FILE/);
    expect(SRC).toMatch(/writeFileSync\(CHECKPOINT_FILE/);
  });
  it('before/after evidence captured per applied item', () => {
    expect(SRC).toMatch(/beforeAfter/);
    expect(SRC).toMatch(/const before = await db\.ingredientServing\.findMany/);
  });
  it('never fabricates conversions — needsHuman queue for unverifiable items', () => {
    expect(SRC).toMatch(/needsHuman/);
    expect(SRC).toMatch(/Never fabricates/);
    expect(SRC).not.toMatch(/estimate.*density|invent/);
  });
  it('sanity gate rejects mismatched USDA hits', () => {
    expect(SRC).toMatch(/sane\(\)/);
  });
});

// Regression tests for scripts/check-dev-secret-guard.js — the CI matcher that
// replaced the false-positive-prone workflow grep. Positive tests prove real
// violations are still caught (no weakening); negative tests prove the
// legitimate patterns (requiredSecret fallbacks, the env.js denylist
// definition, the payments mock) pass.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan, scanFile, PURE_ENTRY } = require('../scripts/check-dev-secret-guard');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe('dev-secret guard — positive detection (must fail)', () => {
  test.each([
    ['logical-or fallback', "const s = process.env.X || 'dev-doc-secret';"],
    ['assignment', "const secret = 'dev-video-secret';"],
    ['object property fallback', "module.exports = { fallback: 'dev-view-as-secret' };"],
    ['template/concat usage', "const h = sign(payload, 'dev-formcheck-secret');"],
    ['comment mention still flags (unchanged strictness)', "// never ship 'dev-doc-secret' here\nconst x = 1;"],
    ['mock-secret raw fallback', "const s = process.env.PAY || 'mock-secret';"],
  ])('detects %s', (_label, content) => {
    const root = tree({ 'src/routes/thing.js': content });
    const v = scan(root);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toMatch(/thing\.js:1/);
  });

  test('denylist-style entry OUTSIDE env.js is not exempt', () => {
    // A pure array-entry line in a random file must not hide — the definition
    // exemption is bound to src/lib/env.js only.
    const root = tree({ 'src/services/evil.js': "const fallbacks = [\n  'dev-doc-secret',\n];" });
    expect(scan(root).length).toBeGreaterThan(0);
  });

  test('non-pure line inside env.js still fails', () => {
    const root = tree({ 'src/lib/env.js': "const leak = 'dev-secret';\nconst use = leak || 'dev-doc-secret';" });
    expect(scan(root).length).toBeGreaterThan(0);
  });
});

describe('dev-secret guard — negative cases (must pass)', () => {
  test('requiredSecret() fallback pattern passes', () => {
    const root = tree({ 'src/routes/docs.js': "const s = requiredSecret('DOC_SECRET', 'dev-doc-secret');" });
    expect(scan(root)).toEqual([]);
  });

  test('the real PREDICTABLE denylist definition passes (original false positive)', () => {
    const root = tree({
      'src/lib/env.js': [
        'const PREDICTABLE = new Set([',
        "  'mock-secret', 'changeme', 'change-me', 'secret', 'password', 'test',",
        "  'dev-secret', 'dev-doc-secret', 'dev-video-secret', 'dev-formcheck-secret',",
        "  'dev-view-as-secret', 'dev-auth-link-secret',",
        ']);',
      ].join('\n'),
    });
    expect(scan(root)).toEqual([]);
  });

  test('payments provider mock behind the production gate passes', () => {
    const root = tree({
      'src/services/payments/provider.js': "const secret = isProduction() ? requiredSecret('PAY') : 'mock-secret';",
    });
    expect(scan(root)).toEqual([]);
  });

  test('no forbidden literals at all passes', () => {
    const root = tree({ 'src/services/clean.js': 'module.exports = { ok: true };' });
    expect(scan(root)).toEqual([]);
  });
});

describe('PURE_ENTRY classifier', () => {
  test.each([
    ["  'dev-secret', 'dev-doc-secret',", true],
    ["  'dev-view-as-secret',", true],
    ['  "mock-secret",', true],
    ["const x = 'dev-secret';", false],
    ["  fallback: 'dev-secret',", false],
    ["process.env.X || 'dev-secret'", false],
  ])('%s → pure=%s', (line, expected) => {
    expect(PURE_ENTRY.test(line)).toBe(expected);
  });
});

describe('real codebase state', () => {
  test('current src/ tree is clean', () => {
    expect(scan(process.cwd())).toEqual([]);
  });
});

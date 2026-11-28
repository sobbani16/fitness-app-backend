// SEC-P08: no credential material may be committed to the repository.
// Complements gitleaks (diff-scoped) with a whole-tree allowlist check —
// deterministic, no network, runs in the standard jest lane.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

const tracked = () =>
  execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

describe('credential exposure', () => {
  test('no env/key-material files are tracked', () => {
    const bad = tracked().filter(f =>
      (/^\.env(\..*)?$/.test(f) || /(^|\/)\.env(\..*)?$/.test(f)) && f !== '.env.example' ||
      /\.(pem|key|p12|pfx|jks|keystore)$/i.test(f) && !f.startsWith('certs/')
    );
    expect(bad).toEqual([]);
  });

  test('no secret-shaped literals in tracked files', () => {
    const PATTERNS = [
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,   // any private key block
      /\bsk-[a-zA-Z0-9_-]{20,}\b/,               // OpenAI-style API keys
      /\bghp_[A-Za-z0-9]{30,}\b/,                // GitHub PAT
      /\bgho_[A-Za-z0-9]{30,}\b/,                // GitHub OAuth token
      /\bphc_[A-Za-z0-9]{40,}\b/,                // PostHog project key
      /\bAKIA[0-9A-Z]{16}\b/,                    // AWS access key id
      /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,        // Slack tokens
      // Embedded DB creds (non-local, non-placeholder passwords)
      /postgres(ql)?:\/\/[^\s"']+:(?!(?:USER|PASSWORD|password|secret|postgres)\b)[^\s"']+@(?!(?:localhost|127\.0\.0\.1|host)\b)/,
    ];
    const SCANNED = /\.(js|ts|tsx|json|md|yml|yaml|prisma|env|txt|sql|sh|cjs|example)$/i;
    const hits = [];
    for (const f of tracked()) {
      if (!SCANNED.test(f) || f === '.env.example') continue;
      let src;
      try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
      for (const re of PATTERNS) {
        const m = src.match(re);
        if (m) { hits.push(`${f}: matched ${re.source.slice(0, 40)}`); break; }
      }
    }
    expect(hits).toEqual([]);
  });
});

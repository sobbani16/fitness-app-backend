#!/usr/bin/env node
// Read-only configuration readiness report (pc-HUM-77 P07).
// Output contract: name / present / valid / feature / action — nothing else.
// Values are NEVER printed, never inspected beyond shape, never logged.
// Safe to run in any environment: zero mutations, zero network calls.
//
// Usage: node scripts/config-readiness.js [--json]
const FEATURE_MAP = {
  DATABASE_URL: { feature: 'core persistence (all features)', required: true },
  AUTH_LINK_SECRET: { feature: 'auth email links (master signing key)', required: true },
  RESEND_API_KEY: { feature: 'auth email delivery', required: true },
  OPENAI_API_KEY: { feature: 'AI features (coach/scanning/recommendations)', required: false },
  PAYMENTS_WEBHOOK_SECRET: { feature: 'provider webhook verification (commerce only)', required: false },
  DOC_URL_SECRET: { feature: 'signed document URLs (derivable from master)', required: false },
  VIDEO_TOKEN_SECRET: { feature: 'video session tokens (derivable from master)', required: false },
  FORM_CHECK_URL_SECRET: { feature: 'signed form-check clip URLs (derivable from master)', required: false },
  VIEW_AS_SECRET: { feature: 'support view-as tokens (derivable from master)', required: false },
  CORS_ORIGINS: { feature: 'browser cross-origin access (native clients unaffected when empty)', required: false },
  AWS_ACCESS_KEY_ID: { feature: 'media storage uploads', required: false },
  AWS_SECRET_ACCESS_KEY: { feature: 'media storage uploads', required: false },
};
const PREDICTABLE = /^(password|secret|changeme|test|dev|development|1234|0000|x+)$/i;

function shapeValid(name, value) {
  if (!value) return null;              // absent — not invalid, just absent
  if (PREDICTABLE.test(value.trim())) return false;
  if (name.endsWith('_SECRET') || name.endsWith('_KEY') || name === 'AUTH_LINK_SECRET') {
    return value.trim().length >= 16;   // entropy floor by shape — never inspecting content
  }
  if (name === 'DATABASE_URL') return /^postgres(ql)?:\/\//.test(value);
  if (name === 'CORS_ORIGINS') {
    return value.split(',').filter(Boolean).every((o) => {
      try { const u = new URL(o.trim()); return u.protocol === 'https:' || u.hostname === 'localhost'; } catch { return false; }
    });
  }
  return true;
}

function actionFor(name, present, valid, required) {
  if (!present) return required ? 'SET — startup blocked without it' : 'optional — feature inactive until set';
  if (valid === false) return required ? 'REPLACE — predictable/malformed, production refuses to boot' : 'REPLACE — predictable/malformed';
  return 'none';
}

function rows(env = process.env) {
  return Object.entries(FEATURE_MAP).map(([name, meta]) => {
    const raw = env[name];
    const present = typeof raw === 'string' && raw.trim().length > 0;
    const valid = present ? shapeValid(name, raw) : null;
    return {
      name,
      present,
      valid,
      feature: meta.feature,
      action: actionFor(name, present, valid, meta.required),
    };
  });
}

if (require.main === module) {
  const json = process.argv.includes('--json');
  const out = rows();
  if (json) {
    console.log(JSON.stringify({ environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'unknown', rows: out }, null, 2));
  } else {
    console.log('config readiness — name | present | valid | feature | action');
    for (const r of out) {
      console.log(`${r.name} | ${r.present ? 'yes' : 'no'} | ${r.valid === null ? '—' : r.valid ? 'yes' : 'NO'} | ${r.feature} | ${r.action}`);
    }
  }
  const blocked = out.filter((r) => r.action.startsWith('SET') || r.action.startsWith('REPLACE'));
  process.exit(blocked.length && process.env.NODE_ENV === 'production' ? 1 : 0);
}

module.exports = { rows, shapeValid };

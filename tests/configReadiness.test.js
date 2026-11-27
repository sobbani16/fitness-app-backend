// Config readiness command tests (pc-HUM-77 P07): output contract +
// the cardinal rule — values never appear in output, even malformed ones.
const { rows, shapeValid } = require('../scripts/config-readiness');

const BASE = {
  DATABASE_URL: 'postgresql://u:p@h:5432/db',
  AUTH_LINK_SECRET: 'a'.repeat(32),
  RESEND_API_KEY: 're_' + 'x'.repeat(20),
};

describe('output contract — name/present/valid/feature/action only', () => {
  it('every row carries exactly the contract fields', () => {
    const out = rows({ ...BASE });
    for (const r of out) {
      expect(Object.keys(r).sort()).toEqual(['action', 'feature', 'name', 'present', 'valid']);
    }
  });

  it('required missing vars produce SET actions; optional missing produce optional copy', () => {
    const out = rows({});
    const db = out.find((r) => r.name === 'DATABASE_URL');
    expect(db.present).toBe(false);
    expect(db.action).toMatch(/^SET/);
    const ai = out.find((r) => r.name === 'OPENAI_API_KEY');
    expect(ai.action).toMatch(/^optional/);
  });

  it('valid configuration produces action none', () => {
    const out = rows({ ...BASE });
    for (const name of ['DATABASE_URL', 'AUTH_LINK_SECRET', 'RESEND_API_KEY']) {
      expect(out.find((r) => r.name === name).action).toBe('none');
    }
  });
});

describe('value-safety — the cardinal rule', () => {
  it('secret values never appear in serialized output, even malformed ones', () => {
    const evil = 'hunter2-supersecret-value';
    const out = rows({ ...BASE, AUTH_LINK_SECRET: 'x'.repeat(32), VIEW_AS_SECRET: evil, CORS_ORIGINS: 'not-a-url' });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(evil);
    expect(serialized).not.toContain('x'.repeat(32));
    expect(serialized).not.toContain('not-a-url');
    expect(serialized).not.toContain('postgresql://u:p@h');
  });

  it('predictable secrets are detected by shape without echoing them', () => {
    expect(shapeValid('AUTH_LINK_SECRET', 'password')).toBe(false);
    expect(shapeValid('AUTH_LINK_SECRET', 'changeme')).toBe(false);
    expect(shapeValid('AUTH_LINK_SECRET', 'dev')).toBe(false);
    expect(shapeValid('AUTH_LINK_SECRET', 'a'.repeat(32))).toBe(true);
    expect(shapeValid('AUTH_LINK_SECRET', 'short')).toBe(false);   // entropy floor
  });

  it('CORS malformed entries invalid; https+localhost valid', () => {
    expect(shapeValid('CORS_ORIGINS', 'not-a-url')).toBe(false);
    expect(shapeValid('CORS_ORIGINS', 'http://insecure.example.com')).toBe(false);
    expect(shapeValid('CORS_ORIGINS', 'https://app.example.com')).toBe(true);
    expect(shapeValid('CORS_ORIGINS', 'https://a.com, http://localhost:3000')).toBe(true);
  });

  it('absent vars are null-valid, never invalid', () => {
    expect(shapeValid('AUTH_LINK_SECRET', undefined)).toBeNull();
    expect(shapeValid('AUTH_LINK_SECRET', '')).toBeNull();
  });
});

// SEC-P07 startup validation coverage (pc-HUM-77)
const { validateConfig, validateCors, isPredictable } = require('../src/lib/env');

const ORIGINAL_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('capability-secret surface enumerated in readiness rules', () => {
  it('disabled-capability secrets surface as warnings, never block startup', () => {
    delete process.env.DOC_URL_SECRET;
    delete process.env.VIDEO_TOKEN_SECRET;
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
    const { missing, warnings } = validateConfig();
    // capability secrets are never in missing — commerce-disabled must not break fitness
    expect(missing.filter(m => m.includes('DOC_URL') || m.includes('VIDEO_TOKEN'))).toEqual([]);
    expect(warnings.some(w => w.includes('DOC_URL_SECRET'))).toBe(true);
  });

  it('production predictable values are rejected by name not value', () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    process.env.DATABASE_URL = 'postgresql://x';
    process.env.AUTH_LINK_SECRET = 'secret'; // predictable
    const { missing } = validateConfig();
    expect(missing.some(m => m.includes('AUTH_LINK_SECRET') && m.includes('predictable'))).toBe(true);
    // error names the variable, never the value
    expect(missing.join(' ')).not.toContain("'secret'");
  });
});

describe('CORS validation — contradictory config fails safe', () => {
  it('wildcard in production is invalid', () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    const { ok, problems } = validateCors({ CORS_ORIGINS: '*' });
    expect(ok).toBe(false);
    expect(problems[0]).toMatch(/wildcard/);
  });

  it('well-formed origin list passes', () => {
    const { ok, configured } = validateCors({ CORS_ORIGINS: 'https://app.humai.fit,https://staging.humai.fit' });
    expect(ok).toBe(true);
    expect(configured).toBe(true);
  });

  it('malformed entry rejected by shape not echoed content', () => {
    const { ok, problems } = validateCors({ CORS_ORIGINS: 'not-a-url' });
    expect(ok).toBe(false);
    expect(problems[0]).not.toContain('not-a-url');
  });

  it('empty is safe-default in production (no browser cross-origin)', () => {
    const { ok, configured } = validateCors({ CORS_ORIGINS: '' });
    expect(ok).toBe(true);
    expect(configured).toBe(false);
  });
});

describe('predictable detection', () => {
  it('known dev values detected case-insensitively', () => {
    expect(isPredictable('dev-doc-secret')).toBe(true);
    expect(isPredictable('SECRET')).toBe(true);
    expect(isPredictable('xK9#mQ2vLp4nR8sT')).toBe(false);
  });
});

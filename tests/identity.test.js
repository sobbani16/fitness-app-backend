// External-identity linking (OIDC readiness). Uses the real test DB.
const { getPrisma } = require('../src/lib/prisma');
const { linkIdentity, resolveUserByIdentity, unlinkIdentity, listIdentities, normalizeIssuer } = require('../src/services/identity');
const { hashPassword } = require('../src/services/authService');

const prisma = getPrisma();
const ISS = 'https://sso.example.forgerock.io/oauth2/realms/root';
let u1, u2;

beforeAll(async () => {
  const pw = await hashPassword('correct horse battery staple');
  u1 = await prisma.user.create({ data: { email: `oidc-a-${Date.now()}@test.dev`, passwordHash: pw } });
  u2 = await prisma.user.create({ data: { email: `oidc-b-${Date.now()}@test.dev`, passwordHash: pw } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('issuer normalization', () => {
  it('lowercases and strips trailing slash/query', () => {
    expect(normalizeIssuer('HTTPS://SSO.Example.COM/realm/')).toBe('https://sso.example.com/realm');
  });
  it('rejects non-URL issuers', () => expect(() => normalizeIssuer('not a url')).toThrow());
});

describe('linkIdentity', () => {
  it('links an external identity to the authenticated user', async () => {
    const r = await linkIdentity(u1.id, { issuer: ISS, subject: 'sub-123', provider: 'forgerock' });
    expect(r.linked).toBe(true);
    expect(r.identity.userId).toBe(u1.id);
  });
  it('is idempotent for the same user', async () => {
    const r = await linkIdentity(u1.id, { issuer: ISS + '/', subject: 'sub-123' });
    expect(r.linked).toBe(false);
  });
  it('account-takeover: same (iss, sub) cannot bind to another user', async () => {
    await expect(linkIdentity(u2.id, { issuer: ISS, subject: 'sub-123' }))
      .rejects.toMatchObject({ status: 409 });
  });
  it('different subject links fine (one user, multiple identities)', async () => {
    const r = await linkIdentity(u2.id, { issuer: ISS, subject: 'sub-456' });
    expect(r.linked).toBe(true);
  });
});

describe('resolve + list + isolation', () => {
  it('resolves (iss, sub) to the internal userId only', async () => {
    expect(await resolveUserByIdentity(ISS, 'sub-123')).toBe(u1.id);
    expect(await resolveUserByIdentity(ISS, 'nobody')).toBeNull();
  });
  it('listIdentities returns only the caller\'s rows', async () => {
    const mine = await listIdentities(u2.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('sub-456');
  });
  it('cross-user unlink is denied (404, not leaked)', async () => {
    const foreign = (await listIdentities(u1.id))[0];
    await expect(unlinkIdentity(u2.id, foreign.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('lockout guard', () => {
  it('refuses to remove the last sign-in method for passwordless users', async () => {
    const solo = await prisma.user.create({ data: { email: `oidc-solo-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev` } }); // no password
    try {
      const { identity } = await linkIdentity(solo.id, { issuer: ISS, subject: `sub-${solo.id}` });
      await expect(unlinkIdentity(solo.id, identity.id)).rejects.toMatchObject({ status: 409 });
    } finally { await prisma.user.delete({ where: { id: solo.id } }); }
  });
  it('allows unlink when a password exists', async () => {
    const r = await unlinkIdentity(u2.id, (await listIdentities(u2.id))[0].id);
    expect(r.removed).toBe(true);
  });
});

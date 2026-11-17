// ID-token validation — real RSA keys + a local JWKS HTTP server.
const http = require('http');
const { generateKeyPair, exportJWK, SignJWT } = require('jose');

const ISS = 'https://sso.example.test/realm';
const AUD = 'humai-app';
let server, jwksUri, pubJwk, privKey;

const sign = (claims, opts = {}) => new SignJWT(claims)
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
  .setIssuer(opts.iss || ISS).setAudience(opts.aud || AUD)
  .setIssuedAt().setExpirationTime(opts.exp || '10m')
  .sign(opts.key || privKey);

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privKey = pair.privateKey;
  pubJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  server = http.createServer((req, res) => { res.end(JSON.stringify({ keys: [pubJwk] })); });
  await new Promise(r => server.listen(0, r));
  jwksUri = `http://127.0.0.1:${server.address().port}/jwks`;
  process.env.OIDC_ISSUER = ISS; process.env.OIDC_CLIENT_ID = AUD;
  process.env.OIDC_TOKEN_URI = 'https://unused.test/token'; process.env.OIDC_JWKS_URI = jwksUri;
});
afterAll(() => server.close());

const { validateIdToken } = require('../src/services/oidc');

describe('validateIdToken', () => {
  it('accepts a correctly signed token and returns sub', async () => {
    const p = await validateIdToken(await sign({ sub: 'u-1' }));
    expect(p.sub).toBe('u-1');
  });
  it('rejects wrong issuer', async () => {
    await expect(validateIdToken(await sign({ sub: 'x' }, { iss: 'https://evil.test' }))).rejects.toThrow();
  });
  it('rejects wrong audience', async () => {
    await expect(validateIdToken(await sign({ sub: 'x' }, { aud: 'other-app' }))).rejects.toThrow();
  });
  it('rejects expired tokens', async () => {
    await expect(validateIdToken(await sign({ sub: 'x' }, { exp: '-10m' }))).rejects.toThrow();
  });
  it('rejects forged signatures', async () => {
    const evil = (await generateKeyPair('RS256')).privateKey;
    await expect(validateIdToken(await sign({ sub: 'x' }, { key: evil }))).rejects.toThrow();
  });
  it('rejects nonce mismatch when a nonce was sent', async () => {
    const t = await sign({ sub: 'x', nonce: 'expected' });
    await expect(validateIdToken(t, { nonce: 'other' })).rejects.toThrow();
    await expect(validateIdToken(t, { nonce: 'expected' })).resolves.toMatchObject({ sub: 'x' });
  });
  it('rejects tokens without sub', async () => {
    await expect(validateIdToken(await sign({}))).rejects.toThrow();
  });
});

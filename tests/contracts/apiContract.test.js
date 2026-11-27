// Cross-repo contract guard: committed manifest must match the routes+versions
// the server actually serves. Run `npm run contract:emit` after intentional changes.
process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('../../src/app');
const { collect } = require('../../scripts/emit-api-contract');
const manifest = require('../../contracts/api-contract.json');

describe('API contract manifest', () => {
  test('matches emitted routes and version constants', () => {
    const now = collect();
    expect(now.endpoints).toEqual(manifest.endpoints);
    expect(now.apiContract).toBe(manifest.apiContract);
    expect(now.minClientContract).toBe(manifest.minClientContract);
    expect(manifest.endpointCount).toBe(manifest.endpoints.length);
  });

  test('server advertises the same contract versions', async () => {
    const res = await request(app).get('/health');
    expect(Number(res.headers['x-api-contract'])).toBe(manifest.apiContract);
    expect(Number(res.headers['x-min-client-contract'])).toBe(manifest.minClientContract);
  });

  test('client below MIN_CLIENT_CONTRACT gets 426 CLIENT_UPGRADE_REQUIRED', async () => {
    const res = await request(app).get('/health').set('x-client-contract', String(manifest.minClientContract - 1));
    expect(res.status).toBe(426);
    expect(res.body.code).toBe('CLIENT_UPGRADE_REQUIRED');
  });
});

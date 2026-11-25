const mockCreate = jest.fn();
jest.mock('openai', () => ({ OpenAI: function() { this.responses = { create: mockCreate }; } }));
const env = {};
for (const k of ['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_MODEL_TRIVIAL','OPENAI_MODEL_COMPLEX']) env[k] = process.env[k];
let provider;
beforeEach(() => {
  jest.resetModules(); mockCreate.mockReset();
  process.env.OPENAI_API_KEY = 'test-only-never-sent';
  delete process.env.OPENAI_MODEL; delete process.env.OPENAI_MODEL_TRIVIAL; delete process.env.OPENAI_MODEL_COMPLEX;
  provider = require('../src/services/aiProvider');
});
afterAll(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
const call = (user, options) => provider.askJSON('t', { a: { type: 'string' } }, 'i', 'x', null, user, options);

test('tiers map to distinct models and default to standard', async () => {
  expect(provider.resolveModel()).toBe('gpt-5.4-mini');
  expect(provider.resolveModel('trivial')).toBe('gpt-5.4-nano');
  expect(provider.resolveModel('complex')).toBe('gpt-6.1-sol');
  expect(provider.resolveModel('bogus')).toBe('gpt-5.4-mini');
  mockCreate.mockResolvedValue({ status: 'completed', output_text: '{"a":"ok"}', usage: { total_tokens: 5 } });
  for (const [tier, want] of [[undefined, 'gpt-5.4-mini'], ['trivial', 'gpt-5.4-nano'], ['complex', 'gpt-6.1-sol']]) {
    await call(`u-${tier}`, { tier });
    expect(mockCreate.mock.calls.at(-1)[0].model).toBe(want);
  }
});
test('env overrides win over built-in tier names', () => {
  process.env.OPENAI_MODEL_TRIVIAL = 'nano-x';
  jest.resetModules();
  provider = require('../src/services/aiProvider');
  expect(provider.resolveModel('trivial')).toBe('nano-x');
});

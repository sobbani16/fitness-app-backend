const mockCreate = jest.fn();
jest.mock('openai', () => ({ OpenAI: function() { this.responses = { create: mockCreate }; } }));
const env = { key: process.env.OPENAI_API_KEY, cap: process.env.AI_USER_DAILY_CALL_CAP };
let provider;
beforeEach(() => {
  jest.resetModules(); mockCreate.mockReset();
  process.env.OPENAI_API_KEY = 'test-only-never-sent'; process.env.AI_USER_DAILY_CALL_CAP = '1';
  provider = require('../src/services/aiProvider');
});
afterAll(() => {
  for (const [key, value] of [['OPENAI_API_KEY', env.key], ['AI_USER_DAILY_CALL_CAP', env.cap]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const call = user => provider.askJSON('test', { answer: { type: 'string' } }, 'test', 'test', null, user);
test('reserves quota before a concurrent provider call and accounts actual tokens', async () => {
  let resolve;
  mockCreate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = call('alice');
  await expect(call('alice')).rejects.toMatchObject({ status: 429 });
  resolve({ status: 'completed', output_text: '{"answer":"ok"}', usage: { total_tokens: 25 } });
  await expect(first).resolves.toEqual({ answer: 'ok' });
  expect(provider.aiUsage('alice')).toMatchObject({ callsToday: 1, tokensToday: 25 });
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('failed provider attempts consume quota without blocking another account', async () => {
  mockCreate.mockRejectedValueOnce(new Error('offline'));
  await expect(call('alice')).rejects.toMatchObject({ status: 502 });
  await expect(call('alice')).rejects.toMatchObject({ status: 429 });
  mockCreate.mockResolvedValueOnce({ status: 'completed', output_text: '{"answer":"ok"}' });
  await expect(call('bob')).resolves.toEqual({ answer: 'ok' });
});

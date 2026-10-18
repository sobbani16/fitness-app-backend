const { parseArgs } = require('../scripts/provision-admin');
const { validate, targetIdentity, provisionAdmin } = require('../src/services/adminProvisioning');
const base = { mode: 'bootstrap', userId: 'a0000000-0000-4000-8000-000000000001', operator: 'operator-1', reference: 'review-123' };
it('requires explicit values and rejects duplicate/unknown CLI flags', () => {
  expect(parseArgs(['--mode', 'bootstrap', '--reviewed'])).toEqual({ mode: 'bootstrap', reviewed: true });
  for (const args of [['--mode'], ['--password', 'secret'], ['--apply', '--apply'], ['--mode', '--apply']]) expect(() => parseArgs(args)).toThrow();
});
it('allows a preview but requires explicit review and state for application', () => {
  expect(() => validate(base)).not.toThrow();
  expect(() => validate({ ...base, apply: true })).toThrow();
  expect(() => validate({ ...base, apply: true, reviewed: true, expectedState: 'a'.repeat(64) })).not.toThrow();
  expect(() => validate({ ...base, operator: 'person@example.com' })).toThrow();
  expect(() => validate({ ...base, userId: 'device-id' })).toThrow();
});
it('never exposes credentials in target identity', () => {
  expect(targetIdentity('postgresql://user:private@127.0.0.1:55432/disposable?password=secret')).toBe('127.0.0.1:55432/disposable?schema=public');
  expect(() => targetIdentity('https://example.com')).toThrow();
  expect(() => targetIdentity('postgresql://localhost/db?host=/other')).toThrow();
  expect(targetIdentity('postgresql://localhost/db?schema=beta')).toContain('schema=beta');
});
it('rejects invalid input before touching the database', async () => {
  const db = { $transaction: jest.fn() };
  await expect(provisionAdmin(db, { ...base, apply: true })).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});

const mockPrisma = { $transaction: jest.fn() };
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const { coachingTransaction } = require('../src/services/coachingTransaction');
beforeEach(() => jest.resetAllMocks());
test('retries serialization conflicts with the entire callback and bounded settings', async () => {
  const callback = jest.fn(), conflict = Object.assign(new Error('conflict'), { code: 'P2034' });
  mockPrisma.$transaction.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ id: 'committed' });
  expect(await coachingTransaction(callback)).toEqual({ id: 'committed' });
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  expect(mockPrisma.$transaction).toHaveBeenLastCalledWith(callback, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 15000 });
});
test('stops retrying after three serialization failures', async () => {
  const conflict = Object.assign(new Error('conflict'), { code: 'P2034' });
  mockPrisma.$transaction.mockRejectedValue(conflict);
  await expect(coachingTransaction(jest.fn())).rejects.toBe(conflict);
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
});
test('does not retry audit or validation failures', async () => {
  const failure = new Error('Audit write failed');
  mockPrisma.$transaction.mockRejectedValue(failure);
  await expect(coachingTransaction(jest.fn())).rejects.toBe(failure);
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
});

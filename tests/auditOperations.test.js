const mockPrisma = { auditLog: { findMany: jest.fn(), create: jest.fn() } };
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const audit = require('../src/services/auditService');
const operations = require('../src/services/adminOperations');
beforeEach(() => jest.clearAllMocks());
test.each(['-1', '0', '101', '1.5', 'abc', ['10'], {}, '9007199254740992'])('rejects invalid audit limit %p before querying', async limit => {
  await expect(audit.query({ limit })).rejects.toMatchObject({ status: 400 });
  expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
});
test.each([{ offset: '-1' }, { offset: '10001' }, { actorId: ['x'] }, { from: 'yesterday' }, { from: '2026-10-18T00:00:00Z', to: '2026-10-17T00:00:00Z' }])('rejects invalid filters %p', async options => {
  await expect(audit.query(options)).rejects.toMatchObject({ status: 400 });
});
test('bounds query and sanitizes old private snapshots', async () => {
  mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 'event', afterData: { clientId: 'client', title: 'Private diagnosis', password: 'secret', reasons: ['sensitive'], active: true } }]);
  expect(await audit.query({ action: 'plan.create', limit: '10' })).toEqual([{ id: 'event', beforeData: {}, afterData: { clientId: 'client', active: true } }]);
  expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, skip: 0, where: { action: 'plan.create' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
});
test('writes only approved metadata using supplied transaction', async () => {
  const tx = { auditLog: { create: jest.fn() } };
  await audit.log({ actorId: 'a', action: 'plan.create', entityType: 'MealPlan', afterData: { userId: 'u', title: 'private', token: 'secret', nested: { password: 'secret' } } }, tx);
  expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ afterData: { userId: 'u' } }) });
  expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
});
test.each(['false', 0, null, undefined, {}])('trainer verification rejects nonboolean %p', async value => {
  await expect(operations.verifyTrainer('admin', 'trainer', value)).rejects.toMatchObject({ status: 400 });
});

// pc-HUM-44 follow-up: a gate ERROR must surface as unverifiable, never
// silence — silence reads as "no restrictions" to the trainer.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
jest.mock('../src/services/activitySafety/gate', () => ({ safetyGate: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { safetyGate } = require('../src/services/activitySafety/gate');
const formChecks = require('../src/services/formChecks');

beforeEach(() => {
  safetyGate.mockRejectedValue(new Error('db down'));
  getPrisma.mockReturnValue({
    trainerProfile: { findUnique: jest.fn(async () => ({ id: 't1', userId: 'trainer-user', verified: true, applicationStatus: 'approved', active: true })) },
    trainerClient: { findUnique: jest.fn(async () => ({ id: 'rel1', trainerId: 't1', clientId: 'u1', status: 'active' })) },
    formCheckRequest: { create: jest.fn(async ({ data }) => ({ id: 'fc-new', status: 'requested', createdAt: new Date(), ...data })) },
  });
});

test('formChecks: gate error produces an unverifiable notice, not silence', async () => {
  const r = await formChecks.createRequest('trainer-user', { relationId: 'rel1', exerciseName: 'Squat' });
  expect(r.clientSafetyNotice).toMatch(/could not be verified/i);
});

test('trainerCopilot: gate error yields explicit error state with cautionary note', async () => {
  const { safetyPresence } = require('../src/services/trainerCopilot');
  const presence = await safetyPresence('u1');
  expect(presence.error).toBe(true);
  expect(presence.available).toBe(false);
  expect(presence.note).toMatch(/could not be verified/i);
});

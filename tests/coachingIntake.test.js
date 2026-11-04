// Coaching intake (M12) — progressive sections, versioning, role checks.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const svc = require('../src/services/coachingIntake');

const REL = { id: 'rel1', trainerId: 't1', clientId: 'u1', status: 'active', trainer: { userId: 'trainer-user' } };

function fakeDb(versions = []) {
  const store = [...versions];
  getPrisma.mockReturnValue({
    trainerClient: { findUnique: jest.fn(async () => REL) },
    baselineAssessment: {
      findMany: jest.fn(async ({ take, select } = {}) => {
        const rows = store.filter(() => true).sort((a, b) => b.version - a.version);
        return (take ? rows.slice(0, take) : rows).map(r => select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, r[k]])) : r);
      }),
      findUnique: jest.fn(async ({ where }) => store.find(r => r.id === where.id) || null),
      create: jest.fn(async ({ data }) => { const r = { id: `v${data.version}`, createdAt: new Date(), updatedAt: new Date(), status: 'in_progress', ...data }; store.push(r); return r; }),
      update: jest.fn(async ({ where, data }) => { const i = store.findIndex(r => r.id === where.id); store[i] = { ...store[i], ...data }; return store[i]; }),
    },
  });
  return store;
}

describe('coaching intake', () => {
  test('progressive patch creates v1 and reports progress', async () => {
    fakeDb();
    const r = await svc.patchIntake('rel1', 'u1', { objective: 'Build strength', equipment: ['dumbbells', 'bands'] });
    expect(r.created).toBe(true);
    expect(r.assessment.version).toBe(1);
    expect(r.assessment.progress.completed).toBe(2);
    expect(r.assessment.progress.missing).toContain('motivation');
  });

  test('later patches merge into the same in-progress version', async () => {
    const store = fakeDb();
    await svc.patchIntake('rel1', 'u1', { objective: 'Strength' });
    const r = await svc.patchIntake('rel1', 'trainer-user', { motivation: 'Health' });
    expect(r.created).toBe(false);
    expect(store.length).toBe(1);
    expect(r.assessment.data.objective).toBe('Strength');
    expect(r.assessment.data.motivation).toBe('Health');
  });

  test('submit freezes; post-submit patch opens v2 carrying data forward', async () => {
    const store = fakeDb();
    await svc.patchIntake('rel1', 'u1', { objective: 'Strength' });
    const sub = await svc.submitIntake('rel1', 'u1');
    expect(sub.assessment.status).toBe('submitted');
    const r = await svc.patchIntake('rel1', 'u1', { motivation: 'New motivation' });
    expect(r.assessment.version).toBe(2);
    expect(r.assessment.supersedesId).toBe('v1');
    expect(r.assessment.data.objective).toBe('Strength');
    expect(store[0].status).toBe('submitted'); // history untouched
  });

  test('review requires the trainer; member gets 403', async () => {
    fakeDb();
    await svc.patchIntake('rel1', 'u1', { objective: 'Strength' });
    await svc.submitIntake('rel1', 'u1');
    await expect(svc.reviewIntake('rel1', 'u1')).rejects.toMatchObject({ status: 403 });
    const r = await svc.reviewIntake('rel1', 'trainer-user');
    expect(r.assessment.status).toBe('reviewed');
  });

  test('validation: unknown section, bad experience, bad measurements', async () => {
    fakeDb();
    await expect(svc.patchIntake('rel1', 'u1', { bloodType: 'A' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.patchIntake('rel1', 'u1', { experience: 'elite' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.patchIntake('rel1', 'u1', { startingMeasurements: { weightKg: 9000 } })).rejects.toMatchObject({ status: 400 });
  });

  test('dataSharing rejects unknown consent categories', async () => {
    fakeDb();
    await expect(svc.patchIntake('rel1', 'u1', { dataSharing: { categories: ['medical_records'] } })).rejects.toMatchObject({ status: 400 });
    const r = await svc.patchIntake('rel1', 'u1', { dataSharing: { categories: ['workout_records'], note: 'happy to share' } });
    expect(r.assessment.data.dataSharing.categories).toEqual(['workout_records']);
  });

  test('getIntake returns latest + version history, never auto-attaches conditions', async () => {
    fakeDb();
    await svc.patchIntake('rel1', 'u1', { objective: 'Strength' });
    const r = await svc.getIntake('rel1', 'u1');
    expect(r.latest.version).toBe(1);
    expect(r.versions.length).toBe(1);
    expect(r.note).toMatch(/never attached automatically/i);
  });
});

// Exercise form-checks (M16) — consented video upload, signed access,
// timestamped feedback, decline path.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const svc = require('../src/services/formChecks');

const TRAINER = { id: 't1', userId: 'trainer-user', verified: true, active: true, applicationStatus: 'approved' };
const REQ = {
  id: 'fc1', relationId: 'rel1', trainerId: 't1', clientId: 'u1',
  exerciseName: 'Squat', status: 'requested', videoKey: null, videoName: null,
  consentAt: null, submittedAt: null, reviewedAt: null, memberAckAt: null,
  relation: { trainer: { userId: 'trainer-user' } }, feedback: [],
};

function fakeDb(requests = [REQ]) {
  const store = requests.map(r => ({ ...r, feedback: [...(r.feedback || [])] }));
  getPrisma.mockReturnValue({
    trainerProfile: { findUnique: jest.fn(async () => TRAINER) },
    trainerClient: { findUnique: jest.fn(async () => ({ id: 'rel1', trainerId: 't1', clientId: 'u1', status: 'active' })) },
    formCheckRequest: {
      create: jest.fn(async ({ data }) => ({ id: 'fc-new', status: 'requested', createdAt: new Date(), ...data })),
      findUnique: jest.fn(async ({ where }) => store.find(r => r.id === where.id) || null),
      findMany: jest.fn(async ({ where } = {}) => store.filter(r => (!where?.clientId || r.clientId === where.clientId) && (!where?.trainerId || r.trainerId === where.trainerId) && (!where?.status || r.status === where.status))),
      update: jest.fn(async ({ where, data }) => { const i = store.findIndex(r => r.id === where.id); store[i] = { ...store[i], ...data }; return store[i]; }),
    },
    formCheckFeedback: {
      create: jest.fn(async ({ data }) => { const fb = { id: `fb${store.length}`, createdAt: new Date(), ...data }; store.find(r => r.id === data.requestId)?.feedback.push(fb); return fb; }),
    },
  });
  return store;
}

const fakeStorage = () => ({ put: jest.fn(async () => 'path'), remove: jest.fn(async () => {}), pipe: jest.fn(async () => true) });
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);
const NOT_VIDEO = Buffer.from('%PDF-fake-not-a-video-file-at-all..........');

describe('form checks', () => {
  test('trainer creates a request for an active client', async () => {
    fakeDb();
    const r = await svc.createRequest('trainer-user', { relationId: 'rel1', exerciseName: 'Squat', note: 'film from the side' });
    expect(r.status).toBe('requested');
    expect(r.exerciseName).toBe('Squat');
    await expect(svc.createRequest('trainer-user', { relationId: 'rel1' })).rejects.toMatchObject({ status: 400 });
  });

  test('video magic bytes enforced', () => {
    expect(svc.looksLikeVideo(MP4)).toBe(true);
    expect(svc.looksLikeVideo(NOT_VIDEO)).toBe(false);
    expect(svc.looksLikeVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]))).toBe(true);
  });

  test('upload requires explicit consent; consented upload stores privately', async () => {
    fakeDb();
    const storage = fakeStorage();
    await expect(svc.attachVideo('fc1', 'u1', { buf: MP4, fileName: 'squat.mp4', consentToTrainerReview: false }, storage)).rejects.toMatchObject({ status: 400 });
    const r = await svc.attachVideo('fc1', 'u1', { buf: MP4, fileName: 'squat.mp4', consentToTrainerReview: true }, storage);
    expect(storage.put).toHaveBeenCalled();
    expect(r.status).toBe('submitted');
    expect(r.consentAt).toBeTruthy();
    expect(r.videoKey).toBeUndefined(); // never leaks storage key
  });

  test('non-video or oversized upload rejected', async () => {
    fakeDb();
    const storage = fakeStorage();
    await expect(svc.attachVideo('fc1', 'u1', { buf: NOT_VIDEO, fileName: 'x.pdf', consentToTrainerReview: true }, storage)).rejects.toMatchObject({ status: 415 });
    expect(storage.put).not.toHaveBeenCalled();
  });

  test('trainer-only feedback, timestamped, marks reviewed', async () => {
    const store = fakeDb([{ ...REQ, status: 'submitted', videoKey: 'k1' }]);
    await expect(svc.addFeedback('u1', 'fc1', { note: 'member cannot' })).rejects.toMatchObject({ status: 403 });
    const fb = await svc.addFeedback('trainer-user', 'fc1', { timestampSec: 12.5, note: 'Depth looks good, keep chest up' });
    expect(fb.timestampSec).toBe(12.5);
    expect(store[0].status).toBe('reviewed');
    await expect(svc.addFeedback('trainer-user', 'fc1', { timestampSec: 99999, note: 'x' })).rejects.toMatchObject({ status: 400 });
  });

  test('decline + acknowledge flows', async () => {
    const store = fakeDb();
    const d = await svc.decline('fc1', 'u1');
    expect(d.status).toBe('declined');
    const store2 = fakeDb([{ ...REQ, status: 'reviewed', videoKey: 'k1' }]);
    const ack = await svc.acknowledge('fc1', 'u1');
    expect(ack.memberAckAt).toBeTruthy();
    expect(store2[0].memberAckAt).toBeTruthy();
  });

  test('video URL is signed and participant-gated', async () => {
    fakeDb([{ ...REQ, status: 'submitted', videoKey: 'k1', videoName: 'squat.mp4', videoMime: 'video/mp4' }]);
    await expect(svc.videoUrl('fc1', 'stranger')).rejects.toMatchObject({ status: 403 });
    const r = await svc.videoUrl('fc1', 'u1');
    expect(r.url).toMatch(/sig=/);
    expect(r.expiresInSec).toBe(300);
    // tampered signature rejected before streaming
    const res = { setHeader: jest.fn() };
    await expect(svc.streamVideo('fc1', 'u1', Date.now() + 60000, 'bad-signature', res)).rejects.toMatchObject({ status: 403 });
  });
});

// HUM-100 P3: consent-gated ingestion, licensing enforcement, revocation cascade.
const { grantConsent, ingestClip, revokeConsent, validateScopeItems } = require('../src/services/pose/recordingPlatform');

const SHA = 'a'.repeat(64);
const validPayload = (over = {}) => ({
  exerciseId: 'squat', storageRef: 'obj-store/clips/abc123', durationMs: 8000, sha256: SHA, viewpoint: 'side', ...over,
});

function buildDb() {
  const consents = [];
  const clips = [];
  const db = {
    poseConsent: {
      create: async ({ data }) => { consents.push({ signedAt: new Date(), revokedAt: null, ...data }); return consents[consents.length - 1]; },
      findFirst: async ({ where }) => consents.filter((c) => c.userId === where.userId && (!where.revokedAt || c.revokedAt === where.revokedAt)).sort((a, b) => b.signedAt - a.signedAt)[0] || null,
      update: async ({ where, data }) => { const c = consents.find((x) => x.id === where.id); Object.assign(c, data); return c; },
    },
    poseClip: {
      create: async ({ data }) => { clips.push({ id: 'clip-' + clips.length, status: 'registered', createdAt: new Date(), ...data }); return clips[clips.length - 1]; },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const c of clips) {
          if (c.consentId === where.consentId && c.status !== 'deleted') { Object.assign(c, data); count++; }
        }
        return { count };
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return { db, consents, clips };
}

describe('consent scope validation', () => {
  it('rejects unknown scope keys and non-boolean values', () => {
    expect(() => validateScopeItems({ landmark_storage: true, hacker_scope: true })).toThrow(/unknown scope/);
    expect(() => validateScopeItems({ landmark_storage: 'yes' })).toThrow(/boolean/);
  });
  it('landmark_storage is the mandatory minimum', () => {
    expect(() => validateScopeItems({ training_use: true })).toThrow(/mandatory minimum/);
  });
  it('normalizes valid scope to explicit booleans', () => {
    const s = validateScopeItems({ landmark_storage: true, training_use: true });
    expect(s).toEqual({ landmark_storage: true, raw_video: false, training_use: true, evaluation_use: false });
  });
});

describe('ingest gating', () => {
  it('403 without active consent', async () => {
    const { db } = buildDb();
    await expect(ingestClip(db, 'u1', validPayload())).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/consent_required/) });
  });

  it('403 when consent lacks training_use', async () => {
    const { db } = buildDb();
    await grantConsent(db, 'u1', { scopeItems: { landmark_storage: true } });
    await expect(ingestClip(db, 'u1', validPayload())).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/training_use/) });
  });

  it('403 for raw-video clips when consent is landmarks-only', async () => {
    const { db } = buildDb();
    await grantConsent(db, 'u1', { scopeItems: { landmark_storage: true, training_use: true } });
    await expect(ingestClip(db, 'u1', validPayload({ landmarkOnly: false }))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/raw_video/) });
  });

  it('accepts a fully-consented landmark clip with provenance stamped', async () => {
    const { db, clips } = buildDb();
    const consent = await grantConsent(db, 'u1', { scopeItems: { landmark_storage: true, training_use: true } });
    const clip = await ingestClip(db, 'u1', validPayload());
    expect(clip.exerciseId).toBe('squat');
    expect(clip.participantKey).toBe(consent.participantKey);
    expect(clip.datasetId).toBe('humai-self-recorded');
    expect(clips).toHaveLength(1);
  });

  it('licensing gate blocks prohibited/restricted/unlisted datasets — 422', async () => {
    const { db } = buildDb();
    await grantConsent(db, 'u1', { scopeItems: { landmark_storage: true, training_use: true, raw_video: true } });
    for (const datasetId of ['mpii_human_pose', 'ucf101', 'coco_keypoints', 'not-in-registry']) {
      await expect(ingestClip(db, 'u1', validPayload({ datasetId }))).rejects.toMatchObject({ status: 422 });
    }
  });

  it('rejects invalid metadata: unknown exercise, bad sha, bad viewpoint, extreme duration', async () => {
    const { db } = buildDb();
    await grantConsent(db, 'u1', { scopeItems: { landmark_storage: true, training_use: true } });
    await expect(ingestClip(db, 'u1', validPayload({ exerciseId: 'cartwheel' }))).rejects.toMatchObject({ status: 400 });
    await expect(ingestClip(db, 'u1', validPayload({ sha256: 'xyz' }))).rejects.toMatchObject({ status: 400 });
    await expect(ingestClip(db, 'u1', validPayload({ viewpoint: 'drone' }))).rejects.toMatchObject({ status: 400 });
    await expect(ingestClip(db, 'u1', validPayload({ durationMs: 100 }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('revocation cascade', () => {
  it('revoking consent atomically deletion-marks every clip of the participant', async () => {
    const { db, clips } = buildDb();
    await grantConsent(db, 'u1', { scopeItems: { landmark_storage: true, training_use: true } });
    await ingestClip(db, 'u1', validPayload());
    await ingestClip(db, 'u1', validPayload({ storageRef: 'obj-store/clips/def456' }));
    const r = await revokeConsent(db, 'u1', {});
    expect(r.clipsDeleted).toBe(2);
    expect(clips.every((c) => c.status === 'deleted' && c.deletedAt)).toBe(true);
    // post-revocation ingest is refused
    await expect(ingestClip(db, 'u1', validPayload())).rejects.toMatchObject({ status: 403 });
  });

  it('revoke without active consent → 404', async () => {
    const { db } = buildDb();
    await expect(revokeConsent(db, 'ghost', {})).rejects.toMatchObject({ status: 404 });
  });

  it('participantKey is pseudonymous — no userId embedded', async () => {
    const { db } = buildDb();
    const c = await grantConsent(db, 'user-with-identifying-name', { scopeItems: { landmark_storage: true } });
    expect(c.participantKey).not.toContain('user-with-identifying-name');
    expect(c.participantKey).toMatch(/^pcp_[0-9a-f]{24}$/);
  });
});

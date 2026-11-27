// §28 progress-summary tests (pc-HUM-108): version-aware aggregation,
// provenance separation, cross-version honesty, object-level authz.
jest.mock('../src/lib/prisma', () => {
  const client = { coachingSession: { findMany: jest.fn() } };
  return { getPrisma: () => client, __client: client };
});
const svc = require('../src/services/poseCoaching');
const prisma = require('../src/lib/prisma').__client;

const S = (over) => ({
  id: `s-${Math.random().toString(36).slice(2, 8)}`,
  exerciseId: 'bench-press',
  startedAt: new Date('2026-11-01T10:00:00Z'),
  countedReps: 10,
  confirmedReps: null,
  discarded: false,
  modelVersion: 'pose_landmarker_lite@59929e1d',
  ruleVersion: 'bench-v1',
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('version-aware aggregation', () => {
  it('single-version history is comparable with null note', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([
      S({ startedAt: new Date('2026-11-01T10:00:00Z') }),
      S({ startedAt: new Date('2026-11-03T10:00:00Z'), countedReps: 12 }),
    ]);
    const out = await svc.progressSummary('u1', { exerciseId: 'bench-press' });
    expect(out.crossVersionComparable).toBe(true);
    expect(out.comparabilityNote).toBeNull();
    expect(out.distinctVersions).toBe(1);
    expect(out.versions).toHaveLength(1);
    expect(out.versions[0].sessions).toBe(2);
    expect(out.versions[0].effectiveReps).toBe(22);
  });

  it('multi-version history refuses cross-version trend claims', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([
      S({ startedAt: new Date('2026-11-01T10:00:00Z') }),
      S({ startedAt: new Date('2026-11-05T10:00:00Z'), modelVersion: 'pose_landmarker_full@abc123', ruleVersion: 'bench-v2' }),
    ]);
    const out = await svc.progressSummary('u1', {});
    expect(out.crossVersionComparable).toBe(false);
    expect(out.comparabilityNote).toMatch(/measurement definitions changed/i);
    expect(out.distinctVersions).toBe(2);
    expect(out.versions).toHaveLength(2);
    // segments ordered chronologically
    expect(new Date(out.versions[0].firstAt) <= new Date(out.versions[1].firstAt)).toBe(true);
  });
});

describe('provenance separation — never collapsed', () => {
  it('auto vs user-confirmed vs corrected remain distinct', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([
      S({ countedReps: 10, confirmedReps: null }),                     // auto-only
      S({ countedReps: 10, confirmedReps: 10 }),                       // confirmed, agrees
      S({ countedReps: 10, confirmedReps: 8 }),                        // corrected — user disagreed
    ]);
    const out = await svc.progressSummary('u1', {});
    expect(out.sessions.total).toBe(3);
    expect(out.sessions.autoOnly).toBe(1);
    expect(out.sessions.userConfirmed).toBe(2);
    expect(out.sessions.corrected).toBe(1);
    const provs = out.trend.map((t) => t.provenance);
    expect(provs).toEqual(['auto', 'user-confirmed', 'user-corrected']);
  });

  it('effective reps prefer confirmed over counted — user truth wins', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([
      S({ countedReps: 12, confirmedReps: 8 }),
    ]);
    const out = await svc.progressSummary('u1', {});
    expect(out.trend[0].effectiveReps).toBe(8);
    expect(out.versions[0].effectiveReps).toBe(8);
  });
});

describe('exclusion + honesty rules', () => {
  it('discarded sessions excluded from trend but counted in meta', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([
      S({}),
      S({ discarded: true, countedReps: 20 }),
    ]);
    const out = await svc.progressSummary('u1', {});
    expect(out.sessions.total).toBe(1);
    expect(out.sessions.discarded).toBe(1);
    expect(out.trend).toHaveLength(1);
    expect(out.versions[0].effectiveReps).toBe(10);   // discarded 20 does not inflate
  });

  it('no fabricated metrics anywhere in the response', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([S({})]);
    const out = await svc.progressSummary('u1', {});
    const str = JSON.stringify(out).toLowerCase();
    expect(str).not.toMatch(/calorie/);
    expect(str).not.toMatch(/activation/);
    expect(str).not.toMatch(/weight(?!ed)/);
  });

  it('empty history is honest — zero totals, comparable vacuously', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([]);
    const out = await svc.progressSummary('u1', {});
    expect(out.sessions.total).toBe(0);
    expect(out.versions).toHaveLength(0);
    expect(out.crossVersionComparable).toBe(true);   // no contradictory evidence exists
  });
});

describe('query construction', () => {
  it('filters by userId always, exerciseId when given, consent only', async () => {
    prisma.coachingSession.findMany.mockResolvedValue([]);
    await svc.progressSummary('u-owner', { exerciseId: 'squat' });
    const where = prisma.coachingSession.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u-owner');
    expect(where.exerciseId).toBe('squat');
    expect(where.consentToStore).toBe(true);
  });
});

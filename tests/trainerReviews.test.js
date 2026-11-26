// Trainer marketplace reviews (pc-HUM-143 / spec PHASE-10): verified-
// participant gating, duplicate prevention, rating validation, published-only
// public projection, separate professional responses, moderation transitions.
const mockPrisma = {
  trainerProfile: { findUnique: jest.fn() },
  trainerClient: { findFirst: jest.fn() },
  trainerPurchase: { findFirst: jest.fn() },
  trainerReview: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const reviews = require('../src/services/trainerReviewService');

const TRAINER = { id: 'tp-1', userId: 'trainer-user-1' };
const INPUT = { overall: 4, quality: 5, communication: 4, body: 'Solid coaching.' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.trainerProfile.findUnique.mockResolvedValue(TRAINER);
  mockPrisma.trainerClient.findFirst.mockResolvedValue({ id: 'rel-1', status: 'active' });
  mockPrisma.trainerPurchase.findFirst.mockResolvedValue(null);
  mockPrisma.trainerReview.findUnique.mockResolvedValue(null);
  mockPrisma.trainerReview.create.mockImplementation(async ({ data }) => ({ id: 'rev-1', ...data }));
  mockPrisma.trainerReview.update.mockImplementation(async ({ data }) => ({ id: 'rev-1', ...data }));
});

describe('verified-participant gate', () => {
  it('rejects clients with no relation and no purchase', async () => {
    mockPrisma.trainerClient.findFirst.mockResolvedValue(null);
    await expect(reviews.upsertReview('client-1', 'tp-1', INPUT)).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.trainerReview.create).not.toHaveBeenCalled();
  });

  it('accepts clients with a non-pending coaching relation', async () => {
    const out = await reviews.upsertReview('client-1', 'tp-1', INPUT);
    expect(out.id).toBe('rev-1');
    expect(mockPrisma.trainerClient.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['active', 'paused', 'completed', 'dropped'] } }),
    }));
  });

  it('accepts clients with a paid purchase when no relation exists', async () => {
    mockPrisma.trainerClient.findFirst.mockResolvedValue(null);
    mockPrisma.trainerPurchase.findFirst.mockResolvedValue({ id: 'pur-1', status: 'paid' });
    const out = await reviews.upsertReview('client-1', 'tp-1', INPUT);
    expect(out.id).toBe('rev-1');
  });

  it('rejects self-review by the professional', async () => {
    await expect(reviews.upsertReview('trainer-user-1', 'tp-1', INPUT)).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.trainerClient.findFirst).not.toHaveBeenCalled();
  });

  it('404s for unknown trainer profiles', async () => {
    mockPrisma.trainerProfile.findUnique.mockResolvedValue(null);
    await expect(reviews.upsertReview('client-1', 'missing', INPUT)).rejects.toMatchObject({ status: 404 });
  });
});

describe('duplicate prevention / edit semantics', () => {
  it('edits the existing review instead of creating a duplicate', async () => {
    mockPrisma.trainerReview.findUnique.mockResolvedValue({ id: 'rev-1', status: 'published' });
    await reviews.upsertReview('client-1', 'tp-1', { overall: 2 });
    expect(mockPrisma.trainerReview.create).not.toHaveBeenCalled();
    expect(mockPrisma.trainerReview.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rev-1' },
      data: expect.objectContaining({ overall: 2 }),
    }));
  });

  it('refuses edits to reviews removed by moderation', async () => {
    mockPrisma.trainerReview.findUnique.mockResolvedValue({ id: 'rev-1', status: 'removed' });
    await expect(reviews.upsertReview('client-1', 'tp-1', INPUT)).rejects.toMatchObject({ status: 409 });
  });
});

describe('rating and body validation', () => {
  it.each([
    ['missing overall', { quality: 4 }],
    ['non-integer rating', { overall: 3.5 }],
    ['out-of-range low', { overall: 0 }],
    ['out-of-range high', { overall: 6 }],
    ['non-integer axis', { overall: 4, clarity: 2.2 }],
  ])('rejects %s', async (_label, input) => {
    await expect(reviews.upsertReview('client-1', 'tp-1', input)).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.trainerReview.create).not.toHaveBeenCalled();
  });

  it('accepts optional axes as absent and caps body length', async () => {
    const out = await reviews.upsertReview('client-1', 'tp-1', { overall: 5 });
    expect(out.overall).toBe(5);
    await expect(reviews.upsertReview('client-1', 'tp-1', { overall: 5, body: 'x'.repeat(2001) }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('ignores mass-assignment fields outside the allowlist', async () => {
    const out = await reviews.upsertReview('client-1', 'tp-1', { ...INPUT, status: 'published', trainerId: 'evil', clientId: 'evil' });
    expect(out.status).toBeUndefined();
    const createData = mockPrisma.trainerReview.create.mock.calls[0][0].data;
    expect(createData.trainerId).toBe('tp-1');
    expect(createData.clientId).toBe('client-1');
    expect(createData).not.toHaveProperty('status');
  });
});

describe('public listing and aggregation', () => {
  it('lists published reviews only with the field allowlist projection', async () => {
    mockPrisma.trainerReview.findMany.mockResolvedValue([]);
    await reviews.listReviews('tp-1');
    const args = mockPrisma.trainerReview.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ trainerId: 'tp-1', status: 'published' });
    expect(args.select).not.toHaveProperty('clientId');
    expect(args.select).not.toHaveProperty('flaggedReason');
  });

  it('aggregates published reviews only and handles zero-review trainers', async () => {
    mockPrisma.trainerReview.findMany.mockResolvedValue([]);
    expect(await reviews.aggregateReviews('tp-1')).toEqual({ count: 0, average: null });
    mockPrisma.trainerReview.findMany.mockResolvedValue([{ overall: 5 }, { overall: 3 }]);
    expect(await reviews.aggregateReviews('tp-1')).toEqual({ count: 2, average: 4 });
  });
});

describe('professional responses', () => {
  it('allows only the reviewed professional and never touches moderation state', async () => {
    mockPrisma.trainerReview.findUnique.mockResolvedValue({ id: 'rev-1', trainerId: 'tp-1', status: 'published' });
    await expect(reviews.respondToReview('other-user', 'rev-1', 'thanks')).rejects.toMatchObject({ status: 403 });
    const out = await reviews.respondToReview('trainer-user-1', 'rev-1', 'Thank you!');
    expect(out.responseBody).toBe('Thank you!');
    const updateData = mockPrisma.trainerReview.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('status');
  });
});

describe('moderation', () => {
  beforeEach(() => {
    mockPrisma.trainerReview.findUnique.mockResolvedValue({ id: 'rev-1', status: 'published' });
  });

  it('requires a reason when flagging or removing', async () => {
    await expect(reviews.moderateReview('rev-1', 'flagged')).rejects.toMatchObject({ status: 400 });
    await expect(reviews.moderateReview('rev-1', 'removed', '  ')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown statuses and 404s on missing reviews', async () => {
    await expect(reviews.moderateReview('rev-1', 'hidden', 'x')).rejects.toMatchObject({ status: 400 });
    mockPrisma.trainerReview.findUnique.mockResolvedValue(null);
    await expect(reviews.moderateReview('rev-1', 'published')).rejects.toMatchObject({ status: 404 });
  });

  it('applies valid transitions and clears the reason on republish', async () => {
    await reviews.moderateReview('rev-1', 'flagged', 'suspected retaliatory review');
    expect(mockPrisma.trainerReview.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'flagged', flaggedReason: 'suspected retaliatory review' }),
    }));
    await reviews.moderateReview('rev-1', 'published');
    expect(mockPrisma.trainerReview.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'published', flaggedReason: null }),
    }));
  });
});

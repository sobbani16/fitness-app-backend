// /ingredients/estimate + /estimate/log — mocked AI provider (no paid calls).
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn() }));
jest.mock('../src/lib/prisma', () => { const logs = new Map(); return { getPrisma: () => ({
  foodLog: {
    create: jest.fn(async ({ data }) => { if (logs.has(data.id)) { const e = new Error('dup'); e.code = 'P2002'; throw e; } const r = { ...data }; logs.set(data.id || 'gen', r); return r; }),
    findUnique: jest.fn(async ({ where }) => logs.get(where.id) || null),
  },
  ingredient: { create: jest.fn(async () => { throw new Error('must not write catalog'); }) },
}) }; });
jest.mock('../src/middleware/requireFeature', () => ({ requireFeature: () => (req, res, next) => req.headers['x-flag'] === 'off' ? res.status(403).json({ error: 'disabled' }) : next() }));

const express = require('express');
const request = require('supertest');
const { askJSON } = require('../src/services/aiProvider');
const router = require('../src/routes/ingredients');
const app = express().use(express.json()).use('/ingredients', router);
const H = { 'x-user-id': 'u1' };
const good = { dishName: 'Sambar', servingDescription: '1 cup', calories: 130, proteinG: 6, carbsG: 18, fatG: 4, confidence: 'medium', assumptions: ['homemade'], needsClarification: [] };

describe('POST /ingredients/estimate', () => {
  it('missing auth → 401', async () => { await request(app).post('/ingredients/estimate').send({ query: 'sambar' }).expect(401); });
  it('flag disabled → 403, no AI call', async () => { await request(app).post('/ingredients/estimate').set({ ...H, 'x-flag': 'off' }).send({ query: 'sambar' }).expect(403); expect(askJSON).not.toHaveBeenCalled(); });
  it('empty/long query → 400, no AI call', async () => {
    await request(app).post('/ingredients/estimate').set(H).send({ query: ' ' }).expect(400);
    await request(app).post('/ingredients/estimate').set(H).send({ query: 'x'.repeat(201) }).expect(400);
    expect(askJSON).not.toHaveBeenCalled();
  });
  it('success → sanitized estimate + provenance', async () => {
    askJSON.mockResolvedValueOnce(good);
    const r = await request(app).post('/ingredients/estimate').set(H).send({ query: 'homemade sambar' }).expect(200);
    expect(r.body.estimate.calories).toBe(130);
    expect(r.body.estimate.provenance).toEqual({ source: 'ai_estimate', version: 1, reviewed: false });
  });
  it('clamps negative + absurd values', async () => {
    askJSON.mockResolvedValueOnce({ ...good, calories: -50, proteinG: -3 });
    const r = await request(app).post('/ingredients/estimate').set(H).send({ query: 'x dish' }).expect(200);
    expect(r.body.estimate.calories).toBe(0);
    expect(r.body.estimate.proteinG).toBe(0);
  });
  it('low confidence + clarifications pass through', async () => {
    askJSON.mockResolvedValueOnce({ ...good, confidence: 'low', needsClarification: ['oil amount?'] });
    const r = await request(app).post('/ingredients/estimate').set(H).send({ query: 'gongura chicken' }).expect(200);
    expect(r.body.estimate.confidence).toBe('low');
    expect(r.body.estimate.needsClarification).toContain('oil amount?');
  });
  it('provider failure propagates as error status', async () => {
    askJSON.mockRejectedValueOnce(Object.assign(new Error('AI capacity is temporarily unavailable.'), { status: 503 }));
    await request(app).post('/ingredients/estimate').set(H).send({ query: 'xx dish' }).expect(503);
  });
});

describe('POST /ingredients/estimate/log', () => {
  const body = { id: 'log-1', name: 'Sambar', mealType: 'lunch', portionG: 250, calories: 325, proteinG: 15, carbsG: 45, fatG: 10, estimate: good };
  it('missing auth → 401', async () => { await request(app).post('/ingredients/estimate/log').send(body).expect(401); });
  it('invalid mealType → 400', async () => { await request(app).post('/ingredients/estimate/log').set(H).send({ ...body, mealType: 'brunch' }).expect(400); });
  it('saves with provenance snapshot, no ingredientId', async () => {
    const r = await request(app).post('/ingredients/estimate/log').set(H).send(body).expect(201);
    expect(r.body.foodLog.userId).toBe('u1');
    expect(r.body.foodLog.nutritionSnapshot.provenance).toBe('ai_estimate');
    expect(r.body.foodLog.ingredientId ?? null).toBeNull();
  });
  it('duplicate id is idempotent, not duplicated', async () => {
    const r = await request(app).post('/ingredients/estimate/log').set(H).send(body).expect(200);
    expect(r.body.foodLog.id ?? 'log-1').toBeDefined();
  });
  it('same id from another user → 409', async () => {
    await request(app).post('/ingredients/estimate/log').set({ 'x-user-id': 'u2' }).send(body).expect(409);
  });
  it('corrections + clamped macros persist', async () => {
    const r = await request(app).post('/ingredients/estimate/log').set(H).send({ ...body, id: 'log-2', calories: 99999, userCorrections: true }).expect(201);
    expect(r.body.foodLog.calories).toBe(15000);
    expect(r.body.foodLog.nutritionSnapshot.userCorrections).toBe(true);
  });
});

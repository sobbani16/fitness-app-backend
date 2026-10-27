jest.mock('../src/services/labelScannerService', () => ({ extractNutritionFromText: jest.fn(), adjustPortion: jest.requireActual('../src/services/labelScannerService').adjustPortion, saveScannedLabel: jest.fn(), getUserLabels: jest.fn() }));
const express = require('express');
const request = require('supertest');
const service = require('../src/services/labelScannerService');
const app = express(); app.use(express.json()); app.use('/labels', require('../src/routes/labelScanner'));
const data = { id: 'stable-label', productName: 'Oats', servingSizeG: 100, actualPortionG: 150, labelCalories: 200, labelProteinG: 10, labelCarbsG: 30, labelFatG: 4, labelFiberG: null };
beforeEach(() => { jest.clearAllMocks(); service.saveScannedLabel.mockResolvedValue({ foodLog: { id: 'food' } }); });
it('keeps stable identity and missing fiber when calling persistence', async () => {
  await request(app).post('/labels/save').set('x-user-id', 'alice').send(data).expect(201);
  expect(service.saveScannedLabel).toHaveBeenCalledWith('alice', expect.objectContaining({ id: 'stable-label', labelFiberG: null, labelSugarG: null }));
});
it.each([{ labelProteinG: null }, { labelCalories: -1 }, { labelFiberG: 'invalid' }, { actualPortionG: 10001 }])('rejects invalid review data %j before persistence', async change => {
  await request(app).post('/labels/save').set('x-user-id', 'alice').send({ ...data, ...change }).expect(400);
  expect(service.saveScannedLabel).not.toHaveBeenCalled();
});
it('returns a retryable service error without internal details', async () => {
  service.saveScannedLabel.mockRejectedValue(new Error('private SQL detail'));
  const result = await request(app).post('/labels/save').set('x-user-id', 'alice').send(data).expect(500);
  expect(result.body.error).not.toContain('SQL');
});
it('adjustment requires known primary nutrients and preserves optional unknowns', async () => {
  await request(app).post('/labels/adjust').send({ servingSizeG: 100, actualPortionG: 150 }).expect(400);
  const result = await request(app).post('/labels/adjust').send({ servingSizeG: 100, actualPortionG: 150, calories: 200, proteinG: 10, carbsG: 30, fatG: 4 }).expect(200);
  expect(result.body.adjusted).toMatchObject({ adjCalories: 300, adjFiberG: null });
});
it('serves versioned insight findings and rejects malformed values', async () => {
  const response = await request(app).post('/labels/insights').send({ingredients:'Maida',reviewed:true}).expect(200);
  expect(response.body.insights[0]).toMatchObject({ruleId:'REFINED_GRAIN_001',confidence:'VERIFIED'});
  await request(app).post('/labels/insights').send({sugarG:'unknown'}).expect(400);
});
it('rejects insights whose reviewed evidence disagrees with the logged meal', async () => {
  await request(app).post('/labels/save').set('x-user-id','alice').send({...data,labelFacts:{reviewed:true,ingredients:'maida',carbsG:999}}).expect(400);
  expect(service.saveScannedLabel).not.toHaveBeenCalled();
});
it('rejects comparison of an unreviewed product', async () => {
  await request(app).post('/labels/compare').send({first:{reviewed:true,basisAmount:100,basisUnit:'g'},second:{reviewed:false}}).expect(400);
});

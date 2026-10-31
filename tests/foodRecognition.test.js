const mockCreate = jest.fn();
const mockConstructor = jest.fn();
jest.mock('openai', () => ({ OpenAI: function(options) { mockConstructor(options); this.responses = { create: mockCreate }; } }));
let detectFood;
const { validateFoodInput } = require('../src/services/foodInput');
const good = { identifiable: true, foodName: 'Rice and beans', caloriesPer100g: 150, suggestedPortionGrams: 250, protein: 5, carbs: 25, fat: 3, confidence: 0.5, uncertainty: 'Portion and cooking oil are unclear.' };
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const originalKey = process.env.OPENAI_API_KEY;
beforeEach(() => { jest.resetModules(); ({ detectFood } = require('../src/services/foodDetector')); jest.clearAllMocks(); process.env.OPENAI_API_KEY = 'test-only'; mockCreate.mockResolvedValue({ status: 'completed', output_text: JSON.stringify(good) }); });
afterAll(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
test('real detector sends image bytes with strict schema, no storage or retries; uncertain estimate requires review', async () => {
  const result = await detectFood({ imageDataUrl: image, hasPhoto: true });
  expect(result).toMatchObject({ estimatedCalories: 375, needsReview: true, lowConfidence: true, uncertainty: good.uncertainty, hasPhoto: true });
  const body = mockCreate.mock.calls[0][0];
  expect(body.input[0].content[1]).toMatchObject({ type: 'input_image', image_url: image });
  expect(body.store).toBe(false); expect(body.max_output_tokens).toBe(1500);
  expect(body.text.format.strict).toBe(true);
  expect(mockConstructor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 30000 }));
});
test.each([{}, { description: 1 }, { hasPhoto: true, description: 'rice' }, { imageDataUrl: 'https://example.com/a.jpg' }, { imageDataUrl: 'data:image/jpeg;base64,YWJj' }, { imageDataUrl: image.replace('png', 'jpeg') }, { imageDataUrl: `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}` }])('rejects invalid input before contacting provider: %p', async input => {
  await expect(detectFood(input)).rejects.toMatchObject({ status: 400 }); expect(mockCreate).not.toHaveBeenCalled();
});
test('missing key fails closed without a fabricated meal', async () => {
  delete process.env.OPENAI_API_KEY;
  await expect(detectFood({ imageDataUrl: image })).rejects.toMatchObject({ status: 503 }); expect(mockCreate).not.toHaveBeenCalled();
});
test.each([
  [{ status: 'completed', output_text: JSON.stringify({ ...good, identifiable: false }) }, 422],
  [{ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }, 422],
  [{ status: 'incomplete', output_text: '{}' }, 502],
  [{ status: 'completed', output_text: 'invalid JSON' }, 502],
  [{ status: 'completed', output_text: JSON.stringify({ ...good, confidence: 2 }) }, 502],
  [{ status: 'completed', output_text: JSON.stringify({ ...good, suggestedPortionGrams: 0 }) }, 502],
  [{ status: 'completed', output_text: JSON.stringify({ ...good, protein: 101 }) }, 502],
])('rejects no-food/refusal or invalid model output', async (output, status) => {
  mockCreate.mockResolvedValue(output);
  await expect(detectFood({ imageDataUrl: image })).rejects.toMatchObject({ status });
});
test.each([[{ status: 429 }, 503], [{ name: 'APIConnectionTimeoutError' }, 504], [{ status: 401, message: 'secret provider detail' }, 502]])('returns safe provider failure', async (failure, status) => {
  mockCreate.mockRejectedValue(failure);
  await expect(detectFood({ imageDataUrl: image })).rejects.toMatchObject({ status });
  await expect(detectFood({ imageDataUrl: image })).rejects.not.toHaveProperty('message', 'secret provider detail');
});
test('accepts a complete PNG payload', () => expect(validateFoodInput({ imageDataUrl: image }).imageDataUrl).toBe(image));
test('text analysis preserves uncertainty and portion basis, scales macros once and sends no image', async () => {
  const { analyzeMeal } = require('../src/services/mealAnalyzer');
  const result = await analyzeMeal({ description: '250g rice and beans', mealType: 'lunch' });
  expect(result).toMatchObject({ name: 'Rice and beans', calories: 375, suggestedPortionGrams: 250, caloriesPer100g: 150, macros: { protein_g: 12.5, carbs_g: 62.5, fat_g: 7.5 }, uncertainty: good.uncertainty, lowConfidence: true, needsReview: true, hasPhoto: false });
  expect(mockCreate.mock.calls[0][0].input[0].content).toEqual([{ type: 'input_text', text: JSON.stringify({ description: '250g rice and beans', mealType: 'lunch' }) }]);
});

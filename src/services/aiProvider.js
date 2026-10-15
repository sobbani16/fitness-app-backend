const { httpError } = require('../lib/errors');
async function askJSON(name, properties, instructions, text, imageDataUrl) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw httpError(503, 'AI service is not configured. Use manual logging or food search.');
  if (imageDataUrl) require('./foodInput').validateFoodInput({ imageDataUrl });
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 });
  const content = [{ type: 'input_text', text }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl, detail: 'auto' });
  let result;
  try {
    result = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini', store: false, instructions,
      input: [{ role: 'user', content }], max_output_tokens: 1500,
      text: { format: { type: 'json_schema', name, strict: true, schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } },
    });
  } catch (e) {
    if (e.status === 429) throw httpError(503, 'AI capacity is temporarily unavailable. Use food search or try later.');
    if (e.name === 'APIConnectionTimeoutError') throw httpError(504, 'AI analysis timed out. Try again or use food search.');
    throw httpError(502, 'AI service could not complete this request. Please retry or enter values manually.');
  }
  if (result.output?.some(item => item.content?.some(part => part.type === 'refusal'))) throw httpError(422, 'This input could not be analyzed. Try another photo or use food search.');
  try {
    if (result.status !== 'completed' || !result.output_text) throw new Error('Incomplete response');
    return JSON.parse(result.output_text);
  } catch {
    throw httpError(502, 'AI service returned an incomplete estimate. Please retry or enter values manually.');
  }
}
module.exports = { askJSON };

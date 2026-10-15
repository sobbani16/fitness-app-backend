// Sends three user-supplied photos to a running API; no provider key goes to the client.
// FOOD_SMOKE_TOKEN is an already authenticated, verified staging-account session.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const base = new URL(process.env.FOOD_SMOKE_API_URL || 'http://127.0.0.1:4000');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use HTTPS or local HTTP.');
  const token = process.env.FOOD_SMOKE_TOKEN;
  if (!token) throw new Error('Set FOOD_SMOKE_TOKEN locally to a verified staging session. Do not paste it into chat.');
  const files = process.argv.slice(2);
  if (files.length !== 3) throw new Error('Usage: node scripts/food-photo-smoke.js clear-meal.jpg ambiguous-meal.jpg non-food.jpg');
  // Read and validate everything before spending any requests.
  const inputs = files.map(file => {
    if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Each photo must be at most 5 MB.');
    const mime = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[path.extname(file).toLowerCase()];
    const input = { hasPhoto: true, imageDataUrl: `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}` };
    require('../src/services/foodInput').validateFoodInput(input); return input;
  });
  for (let i = 0; i < inputs.length; i++) {
    const response = await fetch(new URL('/meals/detect', base), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(inputs[i]), signal: AbortSignal.timeout(45000), redirect: 'error' });
    const result = await response.json();
    const passed = i === 2 ? response.status === 422 : response.status === 200 && result.hasPhoto === true && result.needsReview === true && Number.isFinite(result.estimatedCalories) && (i !== 1 || (result.lowConfidence === true && !!result.uncertainty));
    console.log(JSON.stringify({ case: ['clear-meal', 'ambiguous-meal', 'non-food'][i], status: response.status, passed, lowConfidence: result.lowConfidence }));
    if (!passed) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Photo smoke test could not complete. Check local configuration, photo paths and server availability; secrets and response bodies are not logged.'); process.exitCode = 1; });

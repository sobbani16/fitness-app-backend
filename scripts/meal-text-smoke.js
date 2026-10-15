// Live upstream acceptance through a running, authenticated staging API.
require('dotenv').config({ quiet: true });
async function main() {
  const base = new URL(process.env.FOOD_SMOKE_API_URL || 'http://127.0.0.1:4000');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('Invalid origin');
  const token = process.env.FOOD_SMOKE_TOKEN;
  if (!token) throw new Error('Missing verified staging session');
  const cases = [
    { name: 'specified-portion', description: '200 grams of plain cooked white rice, with no added oil or sauce', portion: 200 },
    { name: 'uncertain-portion', description: 'A bowl of chicken curry with rice; I do not know the amount, recipe or oil used', uncertain: true },
    { name: 'not-food', description: 'A stainless steel fork and an empty ceramic plate, no food', reject: true },
  ];
  for (const item of cases) {
    const response = await fetch(new URL('/meals/analyze', base), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: item.description, mealType: 'lunch' }), signal: AbortSignal.timeout(45000), redirect: 'error' });
    const result = await response.json();
    const nutrition = response.status === 200 && result.needsReview === true && result.hasPhoto === false && Number.isFinite(result.calories) && result.calories > 0 && result.macros && Object.values(result.macros).every(value => Number.isFinite(value) && value >= 0);
    const passed = item.reject ? response.status === 422 : nutrition && (!item.portion || result.suggestedPortionGrams === item.portion) && (!item.uncertain || (result.lowConfidence && !!result.uncertainty));
    console.log(JSON.stringify({ case: item.name, status: response.status, passed: Boolean(passed) }));
    if (!passed) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Text smoke test could not complete. Check FOOD_SMOKE_API_URL, FOOD_SMOKE_TOKEN and server configuration locally.'); process.exitCode = 1; });

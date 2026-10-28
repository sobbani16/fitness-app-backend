// Merges structured fields extracted from multiple images of the same product
// (nutrition panel, ingredients, allergen statement, front packaging).
// Every merged field carries provenance: source panel, OCR evidence and
// confidence. Conflicting values are surfaced — never silently overwritten.
const { extractNutritionFromText, extractWithRegex } = require('./labelScannerService');

const NUTRIENT_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'addedSugarG',
  'sodiumMg', 'saturatedFatG', 'transFatG', 'servingSizeG', 'servingsPerContainer', 'cholesterolMg'];

const BRAND_RE = /(?:manufactured|marketed|packed|imported|distributed)\s+by\s*[:\-]?\s*([^\n,]+)/i;
const BARCODE_RE = /(?:barcode|gtin|ean|upc)\s*[:#.]?\s*(\d{8,14})/i;
const BARE_GTIN_RE = /(?:^|\n)\s*(\d{12,14})\s*(?:\n|$)/;
const CONTAINS_RE = /(?:^|\n)\s*((?:contains|may contain)[:\s][^\n]+)/i;
const INGREDIENTS_RE = /ingredients?\s*:\s*([^\n]+(?:\n(?!\s*(?:contains|allergen|nutrition|best before))[^\n]+)*)/i;

function firstLineCandidate(text) {
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length >= 3 && line.length <= 60 && !/\d{3,}|nutrition|ingredient|contains|best before|serving|calorie|fat\b|protein|carb|sodium|sugar|vitamin|energy|kcal/i.test(line)) return line;
  }
  return null;
}
function tokens(name) {
  return new Set(String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3));
}
function related(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared > 0 && shared / Math.min(ta.size, tb.size) >= 0.5;
}
function evidence(text, value) {
  if (value == null) return null;
  const needle = String(value).split('.')[0];
  const line = String(text).split(/\r?\n/).find(l => l.includes(needle));
  return line ? line.trim().slice(0, 200) : null;
}
// Numeric conflict when two sources differ beyond rounding (>2% and >0.2).
function numericallyDifferent(a, b) {
  return Math.abs(a - b) > Math.max(0.2, Math.abs(a) * 0.02);
}

function perPanelFields(panel, ocrText, extracted) {
  const out = {};
  const t = String(ocrText || '');
  if (panel === 'ingredients' || panel === 'allergens' || panel === 'front' || panel === 'nutrition') {
    const ing = t.match(INGREDIENTS_RE)?.[1]?.trim();
    if (ing) out.ingredients = { value: ing.slice(0, 5000), confidence: 0.8, evidence: 'Ingredients:' };
    const al = t.match(CONTAINS_RE)?.[1]?.trim();
    if (al) out.allergens = { value: al.slice(0, 2000), confidence: 0.8, evidence: al.slice(0, 80) };
  }
  if (panel === 'claims' || panel === 'front') {
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(l => /free|natural|organic|protein|fiber|whole|low|no added|zero|healthy|immunity|energy/i.test(l));
    if (lines.length) out.claims = { value: lines.slice(0, 12).join('; '), confidence: 0.7, evidence: lines[0] };
  }
  if (panel === 'front' || panel === 'nutrition') {
    const brand = t.match(BRAND_RE)?.[1]?.trim();
    if (brand) out.brand = { value: brand.slice(0, 120), confidence: 0.75, evidence: brand };
    const barcode = t.match(BARCODE_RE)?.[1] || t.match(BARE_GTIN_RE)?.[1];
    if (barcode) out.barcode = { value: barcode, confidence: 0.85, evidence: barcode };
    const name = firstLineCandidate(t);
    if (name) out.productName = { value: name, confidence: panel === 'front' ? 0.6 : 0.4, evidence: name };
  }
  if (extracted) {
    // Nutrients are pulled from every panel (a second photo may repeat the
    // nutrition table); non-nutrition panels get lower confidence so real
    // nutrition-panel values stay authoritative while conflicts still surface.
    const base = panel === 'nutrition' ? (extracted.confidence ?? 0.4) : 0.25;
    for (const f of NUTRIENT_FIELDS) {
      if (extracted[f] != null) out[f] = out[f] || { value: extracted[f], confidence: base, evidence: evidence(t, extracted[f]) };
    }
    if (extracted.ingredients) out.ingredients = out.ingredients || { value: extracted.ingredients, confidence: 0.5, evidence: null };
    if (extracted.allergens) out.allergens = out.allergens || { value: extracted.allergens, confidence: 0.5, evidence: extracted.allergens };
    if (extracted.productName) out.productName = out.productName || { value: extracted.productName, confidence: 0.5, evidence: null };
  }
  const column = /per\s*100\s*(g|ml)\b/i.test(t) ? '100' : /per\s*serv|serving size/i.test(t) ? 'serving' : null;
  if (column && (panel === 'nutrition')) out.column = { value: column, confidence: 0.8, evidence: column === '100' ? 'per 100' : 'per serving' };
  const jurisdiction = /fssai|per\s*100\s*g.*kcal|₹|rs\.?\s*\d/i.test(t) ? 'IN' : /nutrition facts|%.*daily value|fda/i.test(t) ? 'US' : null;
  if (jurisdiction && panel === 'nutrition') out.jurisdiction = { value: jurisdiction, confidence: 0.7, evidence: jurisdiction };
  return out;
}

// panels: { nutrition?: text|[text], ingredients?: ..., allergens?: ..., claims?: ..., front?: ... }
// Each panel key may carry multiple images; provenance records `panel` or
// `panel#n` so every source image stays identifiable in capture order.
// Returns { merged, provenance, conflicts, productConflict, panelCount }.
async function mergeLabelPanels(panels) {
  const texts = [];
  for (const [panel, value] of Object.entries(panels || {})) {
    const list = Array.isArray(value) ? value : [value];
    list.forEach((t, i) => { if (t && String(t).trim()) texts.push({ panel, source: list.length > 1 ? `${panel}#${i + 1}` : panel, text: String(t) }); });
  }
  const merged = {}; const provenance = {}; const conflicts = [];
  const productNames = [];

  for (const { panel, source, text } of texts) {
    const extracted = panel === 'nutrition' ? await extractNutritionFromText(text) : extractWithRegex(text);
    const fields = perPanelFields(panel, text, extracted);
    if (fields.productName) productNames.push({ panel: source, name: fields.productName.value });
    for (const [field, cand] of Object.entries(fields)) {
      const entry = { value: cand.value, source, confidence: cand.confidence, evidence: cand.evidence };
      if (merged[field] == null) { merged[field] = entry.value; provenance[field] = [entry]; continue; }
      provenance[field].push(entry);
      const cur = provenance[field][0];
      const numericFields = typeof entry.value === 'number' && typeof cur.value === 'number';
      const differs = numericFields ? numericallyDifferent(entry.value, cur.value) : String(entry.value).toLowerCase() !== String(cur.value).toLowerCase();
      if (differs) conflicts.push({ field, kept: cur, rejected: entry });
      // Keep the highest-confidence value; every candidate stays in provenance.
      provenance[field].sort((a, b) => b.confidence - a.confidence);
      merged[field] = provenance[field][0].value;
    }
  }
  const distinct = [...new Set(productNames.map(p => p.name.toLowerCase()))];
  const productConflict = productNames.length > 1 && !productNames.every(p => related(productNames[0].name, p.name));
  return { merged, provenance, conflicts, productConflict, productNames: distinct, panelCount: texts.length };
}

module.exports = { mergeLabelPanels, numericallyDifferent, related };

// Clinical-measurement registry — allowed metrics, units, and plausibility
// bounds. `bounds` reject physically impossible values; `suspicious` bounds
// (optional) flag unusual-but-possible values via meta.suspicious — never
// silently altered or rejected. Normalization maps non-canonical units to the
// canonical unit in meta.normalized without touching the stored entry.
const METRICS = {
  hba1c:            { label: 'HbA1c', units: { '%': { min: 3, max: 20 }, 'mmol/mol': { min: 9, max: 200 } }, canonical: '%', normalize: { 'mmol/mol': v => +(v / 10.929).toFixed(2) } },
  fasting_glucose:  { label: 'Fasting glucose', units: { 'mg/dL': { min: 30, max: 600 }, 'mmol/L': { min: 1.7, max: 33 } }, canonical: 'mg/dL', normalize: { 'mmol/L': v => +(v * 18.016).toFixed(0) } },
  ldl:              { label: 'LDL cholesterol', units: { 'mg/dL': { min: 10, max: 500 }, 'mmol/L': { min: 0.3, max: 13 } }, canonical: 'mg/dL', normalize: { 'mmol/L': v => +(v * 38.67).toFixed(0) } },
  hdl:              { label: 'HDL cholesterol', units: { 'mg/dL': { min: 5, max: 200 }, 'mmol/L': { min: 0.13, max: 5.2 } }, canonical: 'mg/dL', normalize: { 'mmol/L': v => +(v * 38.67).toFixed(0) } },
  triglycerides:    { label: 'Triglycerides', units: { 'mg/dL': { min: 20, max: 2000 }, 'mmol/L': { min: 0.2, max: 22.6 } }, canonical: 'mg/dL', normalize: { 'mmol/L': v => +(v * 88.57).toFixed(0) } },
  total_cholesterol:{ label: 'Total cholesterol', units: { 'mg/dL': { min: 50, max: 800 }, 'mmol/L': { min: 1.3, max: 21 } }, canonical: 'mg/dL', normalize: { 'mmol/L': v => +(v * 38.67).toFixed(0) } },
  blood_pressure:   { label: 'Blood pressure', units: { 'mmHg': { min: 60, max: 260, min2: 30, max2: 160 } }, canonical: 'mmHg', dual: true },
  waist_cm:         { label: 'Waist circumference', units: { 'cm': { min: 40, max: 250 }, 'in': { min: 16, max: 100 } }, canonical: 'cm', normalize: { 'in': v => +(v * 2.54).toFixed(1) } },
  egfr:             { label: 'eGFR', units: { 'mL/min/1.73m2': { min: 1, max: 150 } }, canonical: 'mL/min/1.73m2' },
  creatinine:       { label: 'Creatinine', units: { 'mg/dL': { min: 0.1, max: 15 }, 'umol/L': { min: 8, max: 1330 } }, canonical: 'mg/dL', normalize: { 'umol/L': v => +(v / 88.4).toFixed(2) } },
  alt:              { label: 'ALT', units: { 'U/L': { min: 1, max: 5000 } }, canonical: 'U/L' },
  ast:              { label: 'AST', units: { 'U/L': { min: 1, max: 5000 } }, canonical: 'U/L' },
  uric_acid:        { label: 'Uric acid', units: { 'mg/dL': { min: 0.5, max: 25 }, 'umol/L': { min: 30, max: 1490 } }, canonical: 'mg/dL', normalize: { 'umol/L': v => +(v / 59.48).toFixed(1) } },
  tsh:              { label: 'TSH', units: { 'mIU/L': { min: 0.01, max: 200 } }, canonical: 'mIU/L' },
  phq9:             { label: 'PHQ-9', units: { 'score': { min: 0, max: 27, integer: true } }, canonical: 'score' },
  gad7:             { label: 'GAD-7', units: { 'score': { min: 0, max: 21, integer: true } }, canonical: 'score' },
  isi:              { label: 'Insomnia Severity Index', units: { 'score': { min: 0, max: 28, integer: true } }, canonical: 'score' },
  psqi:             { label: 'PSQI', units: { 'score': { min: 0, max: 21, integer: true } }, canonical: 'score' },
  weight_kg:        { label: 'Weight', units: { 'kg': { min: 25, max: 400 }, 'lb': { min: 55, max: 880 } }, canonical: 'kg', normalize: { 'lb': v => +(v / 2.20462).toFixed(1) } },
};

const SOURCES = new Set(['user_entry', 'device', 'lab_report', 'clinician']);
const METHODS = new Set(['self_report', 'home_cuff', 'lab_draw', 'clinical_exam', 'questionnaire', 'device_sync', 'other']);

function validate(metric, { value, valueSecondary, unit, source, method, measuredAt }) {
  const def = METRICS[metric];
  if (!def) return { error: `Unknown metric. Supported: ${Object.keys(METRICS).join(', ')}` };
  if (typeof unit !== 'string' || !def.units[unit]) return { error: `unit must be one of: ${Object.keys(def.units).join(', ')}` };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'value must be a number.' };
  const b = def.units[unit];
  if (value < b.min || value > b.max) return { error: `value out of plausible range for ${def.label} (${b.min}–${b.max} ${unit}).` };
  if (b.integer && !Number.isInteger(value)) return { error: `${def.label} must be a whole-number score.` };
  if (def.dual) {
    if (typeof valueSecondary !== 'number' || valueSecondary < b.min2 || valueSecondary > b.max2) return { error: `secondary value (diastolic) out of range (${b.min2}–${b.max2} ${unit}).` };
    if (value <= valueSecondary) return { error: 'Systolic must be greater than diastolic.' };
  } else if (valueSecondary != null) return { error: 'valueSecondary only applies to blood_pressure.' };
  if (source != null && !SOURCES.has(source)) return { error: `source must be one of: ${[...SOURCES].join(', ')}` };
  if (method != null && !METHODS.has(method)) return { error: `method must be one of: ${[...METHODS].join(', ')}` };
  if (!measuredAt || Number.isNaN(new Date(measuredAt).getTime())) return { error: 'measuredAt is required (ISO date).' };
  if (new Date(measuredAt).getTime() > Date.now() + 86400000) return { error: 'measuredAt cannot be in the future.' };
  const normalized = def.normalize?.[unit] ? { value: def.normalize[unit](value), ...(def.dual && valueSecondary != null ? { valueSecondary: def.normalize[unit](valueSecondary) } : {}), unit: def.canonical } : null;
  return { ok: true, normalized };
}

const view = (m) => ({
  id: m.id, metric: m.metric, value: m.value, valueSecondary: m.valueSecondary,
  unit: m.unit, measuredAt: m.measuredAt, source: m.source, method: m.method,
  quality: m.quality, verified: !!m.verifiedAt, correctionOfId: m.correctionOfId,
  meta: m.meta, createdAt: m.createdAt,
});

module.exports = { METRICS, SOURCES, METHODS, validate, view };

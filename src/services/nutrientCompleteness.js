// Explicit unknown-nutrient tracking for FoodLog records.
//
// FoodLog's four macro columns are non-nullable — when a data source does not
// know a value, writers must store 0 in the column even though the value was
// never measured. Without explicit metadata, consumers (daily totals, macro
// scores, health scores, recommendations) silently read stored 0 as a
// confirmed 0. `nutrientUnknowns` in nutritionSnapshot records which of the
// five macro keys the source never actually measured; consumers use
// `unknownsFor(log)` to report coverage instead of pretending certainty.
//
// This mirrors the coverage model already used by nutrientStatus.js
// (present/missing counts, partial/complete coverage).

const MACRO_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'];

// Keys a nutrient-source object never measured. `src` is the raw source block
// (calculated / perServing / sourceNutrition); `saved` is the user-confirmed
// block — a user-entered value IS a declared measurement, so it is not unknown.
function computeUnknowns(src, saved) {
  return MACRO_KEYS.filter((k) => (src ? src[k] == null : true) && (!saved || saved[k] == null));
}

// Unknown nutrient keys for a persisted log. Explicitly stored
// `nutrientUnknowns` wins; otherwise derives from the source blocks in the
// snapshot; otherwise falls back to schema-level nullability (fiber only).
function unknownsFor(log) {
  const s = log?.nutritionSnapshot && typeof log.nutritionSnapshot === 'object' ? log.nutritionSnapshot : {};
  if (Array.isArray(s.nutrientUnknowns)) return s.nutrientUnknowns.filter((k) => MACRO_KEYS.includes(k));
  const src = s.calculated || s.perServing || s.sourceNutrition || null;
  if (src) return computeUnknowns(src, s.saved || null);
  return log?.fiberG == null ? ['fiberG'] : [];
}

// Coverage summary for a set of logs — how many logs have each nutrient
// unknown. Consumers surface this alongside totals so stored zeros are never
// presented as measured zeros.
function coverageFor(logs) {
  const per = {};
  for (const k of MACRO_KEYS) per[k] = { measured: 0, unknown: 0 };
  for (const log of logs) {
    const u = new Set(unknownsFor(log));
    for (const k of MACRO_KEYS) per[k][u.has(k) ? 'unknown' : 'measured']++;
  }
  return per;
}

module.exports = { MACRO_KEYS, computeUnknowns, unknownsFor, coverageFor };

/**
 * Stable trainer-specialty taxonomy. `id` is what gets stored on
 * TrainerProfile.specialties; `label` is the display string the current
 * mobile clients send/render (kept as an alias so legacy free-text values
 * still validate and old rows remain filterable).
 */
const SPECIALTY_TAXONOMY = [
  { id: 'strength_training', label: 'Strength Training' },
  { id: 'hiit', label: 'HIIT' },
  { id: 'yoga', label: 'Yoga' },
  { id: 'running', label: 'Running' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'weight_loss', label: 'Weight Loss' },
  { id: 'muscle_gain', label: 'Muscle Gain' },
  { id: 'flexibility', label: 'Flexibility' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'crossfit', label: 'CrossFit' },
  { id: 'pilates', label: 'Pilates' },
  { id: 'boxing', label: 'Boxing' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'nutrition_coaching', label: 'Nutrition Coaching' },
  { id: 'rehab_recovery', label: 'Rehab & Recovery' },
];

const SPECIALTY_IDS = new Set(SPECIALTY_TAXONOMY.map((s) => s.id));
const LABEL_TO_ID = new Map(SPECIALTY_TAXONOMY.map((s) => [s.label.toLowerCase(), s.id]));

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Resolve an id-or-label to { id, label } or null when unknown. */
function resolveSpecialty(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (SPECIALTY_IDS.has(raw)) return SPECIALTY_TAXONOMY.find((s) => s.id === raw);
  const id = LABEL_TO_ID.get(raw.toLowerCase());
  return id ? SPECIALTY_TAXONOMY.find((s) => s.id === id) : null;
}

/**
 * Normalize a client-supplied specialty list to stable ids. Accepts both ids
 * and display labels (mobile sends labels today); throws 400 on unknown values.
 */
function normalizeSpecialties(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw badRequest('specialties must be an array.');
  const ids = [];
  for (const item of input) {
    const match = resolveSpecialty(item);
    if (!match) throw badRequest(`Unknown specialty: ${item}`);
    if (!ids.includes(match.id)) ids.push(match.id);
  }
  return ids;
}

/**
 * Values a discovery `?specialty=` filter should match — the stable id plus
 * the legacy label so rows stored before the taxonomy still surface.
 */
function specialtyFilterValues(input) {
  const match = resolveSpecialty(input);
  if (!match) return [String(input)];
  return [match.id, match.label];
}

module.exports = { SPECIALTY_TAXONOMY, SPECIALTY_IDS, normalizeSpecialties, specialtyFilterValues };

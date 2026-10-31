// AI workout-plan draft generation — deterministic gate around askJSON.
// AI proposes structure; catalog + suitability rules decide what may appear.
const { EXERCISES, CATALOG_VERSION } = require('./exerciseCatalog');
const { evaluateAll, RULE_VERSION } = require('./exerciseSuitability');
const { askJSON } = require('./aiProvider');
const { httpError } = require('../lib/errors');

const SCHEMA = {
  days: {
    type: 'array', maxItems: 7, items: {
      type: 'object', additionalProperties: false,
      properties: {
        weekday: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        focus: { type: 'string' },
        warmup: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        exercises: {
          type: 'array', minItems: 1, maxItems: 8, items: {
            type: 'object', additionalProperties: false,
            properties: {
              exerciseId: { type: 'string' }, sets: { type: 'integer' }, reps: { type: 'string' },
              restSec: { type: 'integer' }, why: { type: 'string' }, startResistance: { type: 'string' },
            },
            required: ['exerciseId', 'sets', 'reps', 'restSec', 'why', 'startResistance'],
          },
        },
        cooldown: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      },
      required: ['weekday', 'focus', 'warmup', 'exercises', 'cooldown'],
    },
  },
  summary: { type: 'string' },
};

const INSTRUCTIONS = `You design a draft workout plan. Rules:
- Use ONLY exercise IDs from the provided catalog list. Invented IDs are rejected.
- Schedule at most the requested days; never all 7 unless requested.
- Conservative starting volume: beginners 2-3 sets, leave 2+ reps in reserve.
- starting resistance: descriptive only (e.g. "bodyweight", "light dumbbells") — never prescribe a specific heavy load.
- Every exercise needs a 'why' tied to the user's stated goal/equipment/preferences.
- Output strict JSON per schema.`;

// Clamp AI numbers to safe ranges; drop anything not whitelisted.
function sanitizePlan(raw, allowedIds, prefs = {}, errorStatus = 502) {
  const fail = message => { throw httpError(errorStatus, message); };
  if (!raw || !Array.isArray(raw.days) || !raw.days.length || raw.days.length > 7) fail('Plan must contain 1–7 workout days.');
  const weekdays = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  const seen = new Set();
  for (const d of raw.days) {
    if (!d || !weekdays.has(d.weekday) || seen.has(d.weekday)) fail('Workout days must be valid and unique.');
    seen.add(d.weekday);
    if (prefs.preferredDays?.length && !prefs.preferredDays.includes(d.weekday)) fail('Workout day is outside your selected availability.');
    if (!Array.isArray(d.exercises) || d.exercises.length > 8 || d.exercises.some(x => !x || typeof x.exerciseId !== 'string' || typeof x.reps !== 'string' || !/^\d+(?:\s*[-–]\s*\d+)?$/.test(x.reps) || !Number.isFinite(x.sets) || !Number.isFinite(x.restSec))) fail('Review exercise prescriptions.');
    for (const phase of ['warmup', 'cooldown']) {
      if (d[phase] != null && (!Array.isArray(d[phase]) || d[phase].length > 6 || d[phase].some(x => typeof x !== 'string'))) fail('Review warm-up and cool-down steps.');
    }
  }
  const warnings = [];
  const days = (raw.days || []).map(d => ({
    weekday: d.weekday, focus: d.focus || '', warmup: d.warmup || [], cooldown: d.cooldown || [],
    exercises: (d.exercises || []).filter(x => {
      if (!allowedIds.has(x.exerciseId)) { warnings.push(`Removed '${x.exerciseId}' — not suitable/not in catalog`); return false; }
      return true;
    }).map(x => ({ ...x, sets: Math.min(Math.max(Math.trunc(x.sets), 1), 6), restSec: Math.min(Math.max(Math.trunc(x.restSec), 30), 300) })),
  })).filter(d => {
    if (!d.exercises.length) { warnings.push(`Removed ${d.weekday} — no suitable exercises remained`); return false; }
    return true;
  });
  if (!days.length) fail('Plan contained no usable exercises. Adjust preferences and retry.');
  return { plan: { days, summary: raw.summary || '' }, warnings };
}

function candidatesFor(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw httpError(400, 'Invalid workout preferences.');
  for (const key of ['equipment', 'limitations', 'preferredDays', 'likedExercises', 'dislikedExercises']) {
    if (prefs[key] != null && (!Array.isArray(prefs[key]) || prefs[key].length > 64 || prefs[key].some(v => typeof v !== 'string' || v.length > 100))) throw httpError(400, 'Invalid workout preferences.');
  }
  if (prefs.preferredDays?.some(d => !['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(d))
      || prefs.experience != null && !['beginner', 'intermediate', 'advanced'].includes(prefs.experience)
      || prefs.sessionMinutes != null && (!Number.isFinite(prefs.sessionMinutes) || prefs.sessionMinutes < 5 || prefs.sessionMinutes > 240)) throw httpError(400, 'Review your availability and experience.');
  const evaluation = evaluateAll(Object.keys(EXERCISES), { ...prefs, experience: prefs.experience || 'beginner' });
  const allowed = new Set(Object.keys(evaluation).filter(id => evaluation[id].status === 'suitable' && !(prefs.dislikedExercises || []).includes(id)));
  return { allowed, evaluation };
}

async function generateDraft(userId, prefs = {}) {
  const { allowed, evaluation } = candidatesFor(prefs);
  if (!allowed.size) throw httpError(422, 'No suitable exercises for these preferences. Broaden equipment or limitations, or request reviewed guidance.');
  const dislikes = new Set(prefs.dislikedExercises || []);
  dislikes.forEach(id => allowed.delete(id));
  const catalogText = [...allowed].map(id => `${id} (${EXERCISES[id].name}: ${EXERCISES[id].muscle.join('+')}, ${EXERCISES[id].pattern})`).join(', ');
  const text = `Preferences: ${JSON.stringify({
    goal: prefs.goal, experience: prefs.experience || 'beginner', location: prefs.location,
    equipment: prefs.equipment, days: prefs.preferredDays, sessionMinutes: prefs.sessionMinutes,
    intensity: prefs.intensity, liked: prefs.likedExercises, limitations: prefs.limitations,
  })}\nAllowed exercise IDs: ${catalogText}`;
  const raw = await askJSON('workout_plan', SCHEMA, INSTRUCTIONS, text, null, userId);
  const { plan, warnings } = sanitizePlan(raw, allowed, prefs);
  return {
    plan, warnings, suitability: evaluation,
    catalogVersion: CATALOG_VERSION, ruleVersion: RULE_VERSION, status: 'draft',
  };
}

// Re-validate an edited plan (user confirmation or edit path) — same rules.
function validateEditedPlan(plan, prefs = {}) {
  const { allowed } = candidatesFor(prefs);
  return sanitizePlan(plan, allowed, prefs, 400);
}

module.exports = { generateDraft, validateEditedPlan, candidatesFor };

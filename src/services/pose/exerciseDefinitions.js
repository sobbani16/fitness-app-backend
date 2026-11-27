// HUM-100 P4: loader + validator for pose/exercises/definitions.json.
// The definitions are the contract shared by the deterministic baseline,
// dataset annotation schema, and runtime coaching — structural defects here
// corrupt everything downstream, so validation is strict and total.
const fs = require('fs');
const path = require('path');

const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const REQUIRED_EXERCISE_KEYS = ['id', 'displayName', 'primaryLandmarks', 'trackedAngles', 'phases', 'repCriteria', 'coachingCues'];

function validateDefinitions(defs) {
  const errors = [];
  if (!defs || !Array.isArray(defs.exercises) || !defs.exercises.length) {
    return ['definitions must contain a non-empty exercises array'];
  }
  const ids = new Set();
  for (const ex of defs.exercises) {
    for (const k of REQUIRED_EXERCISE_KEYS) {
      if (ex[k] === undefined) errors.push(`${ex.id || '?'}: missing ${k}`);
    }
    if (ids.has(ex.id)) errors.push(`duplicate exercise id ${ex.id}`);
    ids.add(ex.id);
    if (!/^[a-z][a-z0-9_]*$/.test(ex.id || '')) errors.push(`${ex.id}: id must be snake_case`);
    if (!Array.isArray(ex.primaryLandmarks) || ex.primaryLandmarks.length < 4) {
      errors.push(`${ex.id}: primaryLandmarks needs at least 4 entries`);
    }
    for (const a of ex.trackedAngles || []) {
      if (!Array.isArray(a.landmarks) || a.landmarks.length !== 3) errors.push(`${ex.id}/${a.joint}: angle needs exactly 3 landmarks`);
      for (const key of ['standingRange', 'bottomRange']) {
        const r = a[key];
        if (!Array.isArray(r) || r.length !== 2 || r[0] >= r[1] || r[0] < 0 || r[1] > 180) {
          errors.push(`${ex.id}/${a.joint}: ${key} must be a valid [min,max) degree range within 0-180`);
        }
      }
    }
    const phaseNames = new Set((ex.phases || []).map((p) => p.name));
    for (const req of ex.repCriteria?.requiresPhases || []) {
      if (!phaseNames.has(req)) errors.push(`${ex.id}: repCriteria requires phase '${req}' not present in phases`);
    }
    for (const c of ex.coachingCues || []) {
      if (!VALID_SEVERITIES.has(c.severity)) errors.push(`${ex.id}/${c.fault}: severity must be low|medium|high`);
      if (!c.detector || !c.cue) errors.push(`${ex.id}/${c.fault}: cue needs detector logic description + user-facing cue`);
    }
    if (!(ex.coachingCues || []).some((c) => c.severity === 'high')) {
      errors.push(`${ex.id}: needs at least one high-severity safety cue`);
    }
  }
  return errors;
}

function loadDefinitions() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'pose', 'exercises', 'definitions.json'), 'utf8');
  const defs = JSON.parse(raw);
  const errors = validateDefinitions(defs);
  if (errors.length) throw new Error(`exercise definitions invalid: ${errors.join('; ')}`);
  return defs;
}

function getExercise(id) {
  return loadDefinitions().exercises.find((e) => e.id === id) || null;
}

module.exports = { loadDefinitions, validateDefinitions, getExercise };

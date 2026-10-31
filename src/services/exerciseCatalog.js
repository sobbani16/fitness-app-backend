// Canonical exercise catalog — the only exercises AI may reference.
// Metadata drives deterministic suitability; no AI-invented exercises.
// CATALOG_VERSION bumps when rules/metadata change (explainable plans).
const CATALOG_VERSION = 'exercise-catalog.v1';

// equipment: 'barbell'|'dumbbell'|'band'|'machine'|'bodyweight'|'pullup-bar'|'kettlebell'
// position: 'standing'|'seated'|'lying'|'floor'
// pattern: movement classification used by the planner
const EXERCISES = {
  'bench-press':        { name: 'Bench Press', muscle: ['chest', 'triceps'], equipment: ['barbell', 'bench'], difficulty: 'intermediate', pattern: 'push-horizontal', position: 'lying', balance: 'low', mobility: 'shoulder-extension', alternatives: ['push-up', 'db-floor-press'] },
  'db-floor-press':     { name: 'Dumbbell Floor Press', muscle: ['chest', 'triceps'], equipment: ['dumbbell'], difficulty: 'beginner', pattern: 'push-horizontal', position: 'floor', balance: 'low', mobility: 'shoulder-extension', alternatives: ['push-up'] },
  'squat':              { name: 'Barbell Squat', muscle: ['quads', 'glutes'], equipment: ['barbell', 'rack'], difficulty: 'intermediate', pattern: 'squat', position: 'standing', balance: 'moderate', mobility: 'ankle-hip', alternatives: ['goblet-squat', 'leg-press'] },
  'goblet-squat':       { name: 'Goblet Squat', muscle: ['quads', 'glutes'], equipment: ['dumbbell'], difficulty: 'beginner', pattern: 'squat', position: 'standing', balance: 'low', mobility: 'ankle-hip', alternatives: ['leg-press', 'box-squat'] },
  'box-squat':          { name: 'Box Squat', muscle: ['quads', 'glutes'], equipment: ['box', 'bodyweight'], difficulty: 'beginner', pattern: 'squat', position: 'standing', balance: 'low', mobility: 'hip', alternatives: ['chair-squat'] },
  'chair-squat':        { name: 'Sit-to-Stand', muscle: ['quads', 'glutes'], equipment: ['chair', 'bodyweight'], difficulty: 'beginner', pattern: 'squat', position: 'standing', balance: 'low', mobility: 'minimal', alternatives: [] },
  'deadlift':           { name: 'Deadlift', muscle: ['posterior'], equipment: ['barbell'], difficulty: 'advanced', pattern: 'hinge', position: 'standing', balance: 'moderate', mobility: 'hip-hinge', alternatives: ['rdl-dumbbell', 'glute-bridge'] },
  'rdl-dumbbell':       { name: 'Dumbbell Romanian Deadlift', muscle: ['posterior'], equipment: ['dumbbell'], difficulty: 'intermediate', pattern: 'hinge', position: 'standing', balance: 'moderate', mobility: 'hip-hinge', alternatives: ['glute-bridge'] },
  'glute-bridge':       { name: 'Glute Bridge', muscle: ['glutes', 'hamstrings'], equipment: ['bodyweight', 'floor'], difficulty: 'beginner', pattern: 'hinge', position: 'lying', balance: 'low', mobility: 'minimal', alternatives: [] },
  'overhead-press':     { name: 'Overhead Press', muscle: ['shoulders', 'triceps'], equipment: ['barbell'], difficulty: 'intermediate', pattern: 'push-vertical', position: 'standing', balance: 'moderate', mobility: 'shoulder-flexion', alternatives: ['seated-db-press', 'band-press'] },
  'seated-db-press':    { name: 'Seated Dumbbell Press', muscle: ['shoulders', 'triceps'], equipment: ['dumbbell', 'bench'], difficulty: 'beginner', pattern: 'push-vertical', position: 'seated', balance: 'low', mobility: 'shoulder-flexion', alternatives: ['band-press'] },
  'band-press':         { name: 'Band Shoulder Press', muscle: ['shoulders', 'triceps'], equipment: ['band'], difficulty: 'beginner', pattern: 'push-vertical', position: 'standing', balance: 'low', mobility: 'shoulder-flexion', alternatives: [] },
  'barbell-row':        { name: 'Barbell Row', muscle: ['back', 'biceps'], equipment: ['barbell'], difficulty: 'intermediate', pattern: 'pull-horizontal', position: 'standing', balance: 'moderate', mobility: 'hip-hinge', alternatives: ['db-row', 'band-row'] },
  'db-row':             { name: 'Dumbbell Row', muscle: ['back', 'biceps'], equipment: ['dumbbell', 'bench'], difficulty: 'beginner', pattern: 'pull-horizontal', position: 'standing', balance: 'low', mobility: 'minimal', alternatives: ['band-row'] },
  'band-row':           { name: 'Band Row', muscle: ['back', 'biceps'], equipment: ['band'], difficulty: 'beginner', pattern: 'pull-horizontal', position: 'seated', balance: 'low', mobility: 'minimal', alternatives: [] },
  'pull-up':            { name: 'Pull-Up', muscle: ['back', 'biceps'], equipment: ['pullup-bar'], difficulty: 'advanced', pattern: 'pull-vertical', position: 'hanging', balance: 'high', mobility: 'shoulder-flexion', alternatives: ['lat-pulldown', 'band-pulldown'] },
  'lat-pulldown':       { name: 'Lat Pulldown', muscle: ['back', 'biceps'], equipment: ['machine'], difficulty: 'beginner', pattern: 'pull-vertical', position: 'seated', balance: 'low', mobility: 'shoulder-flexion', alternatives: ['band-pulldown'] },
  'band-pulldown':      { name: 'Band Pulldown', muscle: ['back', 'biceps'], equipment: ['band'], difficulty: 'beginner', pattern: 'pull-vertical', position: 'seated', balance: 'low', mobility: 'shoulder-flexion', alternatives: [] },
  'push-up':            { name: 'Push-Up', muscle: ['chest', 'triceps'], equipment: ['bodyweight', 'floor'], difficulty: 'beginner', pattern: 'push-horizontal', position: 'floor', balance: 'moderate', mobility: 'wrist-extension', alternatives: ['incline-push-up', 'knee-push-up'] },
  'incline-push-up':    { name: 'Incline Push-Up', muscle: ['chest', 'triceps'], equipment: ['box', 'bodyweight'], difficulty: 'beginner', pattern: 'push-horizontal', position: 'standing', balance: 'low', mobility: 'wrist-extension', alternatives: ['knee-push-up'] },
  'knee-push-up':       { name: 'Knee Push-Up', muscle: ['chest', 'triceps'], equipment: ['bodyweight', 'floor'], difficulty: 'beginner', pattern: 'push-horizontal', position: 'floor', balance: 'low', mobility: 'wrist-extension', alternatives: [] },
  'leg-press':          { name: 'Leg Press', muscle: ['quads', 'glutes'], equipment: ['machine'], difficulty: 'beginner', pattern: 'squat', position: 'seated', balance: 'low', mobility: 'hip-knee', alternatives: ['goblet-squat'] },
  'lunge':              { name: 'Lunge', muscle: ['quads', 'glutes'], equipment: ['bodyweight'], difficulty: 'intermediate', pattern: 'single-leg', position: 'standing', balance: 'high', mobility: 'hip', alternatives: ['split-squat'] },
  'split-squat':        { name: 'Split Squat', muscle: ['quads', 'glutes'], equipment: ['bodyweight'], difficulty: 'beginner', pattern: 'single-leg', position: 'standing', balance: 'moderate', mobility: 'hip', alternatives: ['goblet-squat'] },
  'plank':              { name: 'Plank', muscle: ['core'], equipment: ['bodyweight', 'floor'], difficulty: 'beginner', pattern: 'core', position: 'floor', balance: 'low', mobility: 'minimal', alternatives: ['dead-bug'] },
  'dead-bug':           { name: 'Dead Bug', muscle: ['core'], equipment: ['bodyweight', 'floor'], difficulty: 'beginner', pattern: 'core', position: 'lying', balance: 'low', mobility: 'minimal', alternatives: [] },
  'farmer-carry':       { name: 'Farmer Carry', muscle: ['grip', 'core'], equipment: ['dumbbell'], difficulty: 'beginner', pattern: 'carry', position: 'standing', balance: 'low', mobility: 'minimal', alternatives: [] },
};

module.exports = { EXERCISES, CATALOG_VERSION };

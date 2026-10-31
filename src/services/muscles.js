// Canonical muscle taxonomy for the exercise library.
// Keys are stable ids used by ExerciseMuscle rows, heatmaps and the
// anatomy explorer. side: which anatomy view draws the region
// ('front' | 'back'); 'both' appears on each view (e.g. forearms).
const MUSCLES = {
  'sternocleidomastoid':  { label: 'Sternocleidomastoid', side: 'front' },
  'trapezius':            { label: 'Trapezius',           side: 'back' },
  'deltoids':             { label: 'Deltoids',            side: 'both' },
  'pectoralis-major':     { label: 'Pectoralis major',    side: 'front' },
  'biceps-brachii':       { label: 'Biceps brachii',      side: 'front' },
  'brachialis':           { label: 'Brachialis',          side: 'front' },
  'brachioradialis':      { label: 'Brachioradialis',     side: 'front' },
  'triceps-brachii':      { label: 'Triceps brachii',     side: 'back' },
  'serratus-anterior':    { label: 'Serratus anterior',   side: 'front' },
  'latissimus-dorsi':     { label: 'Latissimus dorsi',    side: 'back' },
  'forearm-flexors':      { label: 'Forearm flexors',     side: 'front' },
  'forearm-extensors':    { label: 'Forearm extensors',   side: 'back' },
  'rectus-abdominis':     { label: 'Rectus abdominis',    side: 'front' },
  'external-obliques':    { label: 'External obliques',   side: 'front' },
  'erector-spinae':       { label: 'Erector spinae',      side: 'back' },
  'gluteus-maximus':      { label: 'Gluteus maximus',     side: 'back' },
  'gluteus-medius':       { label: 'Gluteus medius',      side: 'back' },
  'adductors':            { label: 'Adductors',           side: 'front' },
  'quadriceps':           { label: 'Quadriceps',          side: 'front' },
  'hamstrings':           { label: 'Hamstrings',          side: 'back' },
  'tibialis-anterior':    { label: 'Tibialis anterior',   side: 'front' },
  'gastrocnemius':        { label: 'Gastrocnemius',       side: 'back' },
  'soleus':               { label: 'Soleus',              side: 'back' },
};

// Dataset/external muscle names → canonical ids.
const MUSCLE_ALIASES = {
  'abdominals':   ['rectus-abdominis'],
  'obliques':     ['external-obliques'],
  'chest':        ['pectoralis-major'],
  'biceps':       ['biceps-brachii', 'brachialis', 'brachioradialis'],
  'triceps':      ['triceps-brachii'],
  'shoulders':    ['deltoids', 'serratus-anterior'],
  'forearms':     ['forearm-flexors', 'forearm-extensors'],
  'lats':         ['latissimus-dorsi'],
  'traps':        ['trapezius'],
  'middle back':  ['latissimus-dorsi', 'trapezius'],
  'lower back':   ['erector-spinae'],
  'neck':         ['sternocleidomastoid'],
  'quadriceps':   ['quadriceps'],
  'hamstrings':   ['hamstrings'],
  'glutes':       ['gluteus-maximus', 'gluteus-medius'],
  'adductors':    ['adductors'],
  'abductors':    ['gluteus-medius'],
  'calves':       ['gastrocnemius', 'soleus'],
  'tibialis anterior': ['tibialis-anterior'],
};

// Equipment vocabulary used by the app (preferences) vs dataset terms.
const EQUIPMENT_ALIASES = {
  'body only':      'bodyweight',
  'other':          'other',
  'foam roll':      'other',
  'kettlebells':    'kettlebell',
  'dumbbell':       'dumbbell',
  'barbell':        'barbell',
  'e-z curl bar':   'barbell',
  'cable':          'machine',
  'machine':        'machine',
  'bands':          'band',
  'medicine ball':  'other',
  'exercise ball':  'other',
};

const canonicalMuscle = raw => MUSCLE_ALIASES[String(raw || '').toLowerCase()] || [];
const canonicalEquipment = raw => EQUIPMENT_ALIASES[String(raw || '').toLowerCase()] || 'other';
const slugify = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

module.exports = { MUSCLES, MUSCLE_ALIASES, EQUIPMENT_ALIASES, canonicalMuscle, canonicalEquipment, slugify };

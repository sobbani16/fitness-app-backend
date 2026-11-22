// Candidate activity catalog — the demand profile the engine evaluates
// against user restrictions. These are CANDIDATES, not universally safe
// substitutes: every one is evaluated independently per user context.
//
// demands:
//   weightBearing  'full' | 'partial' | 'none'  — load through lower limbs
//   regions        { lower_limb, upper_limb, trunk } — 0..1 demand weight
//   impact         'low' | 'moderate' | 'high'
//   balance        'low' | 'moderate' | 'high'
//   categories     ACTIVITY_CATEGORIES the activity belongs to
//   environment    'outdoor' | 'indoor' | 'either' | 'water'
//   exertion       'light' | 'moderate' | 'vigorous'

const { ACTIVITY_CATEGORIES: C } = require('./constants');

const ACTIVITIES = {
  outdoor_walk: {
    id: 'outdoor_walk', label: 'Outdoor walk',
    environment: 'outdoor', exertion: 'moderate',
    demands: {
      weightBearing: 'full', impact: 'low', balance: 'moderate',
      regions: { lower_limb: 1, upper_limb: 0.1, trunk: 0.3 },
      categories: [C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD, C.OUTDOOR_EXPOSED],
    },
    description: 'A walk outside at a comfortable pace.',
  },
  outdoor_run: {
    id: 'outdoor_run', label: 'Outdoor run',
    environment: 'outdoor', exertion: 'vigorous',
    demands: {
      weightBearing: 'full', impact: 'high', balance: 'moderate',
      regions: { lower_limb: 1, upper_limb: 0.2, trunk: 0.5 },
      categories: [C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD, C.IMPACT, C.OUTDOOR_EXPOSED, C.VIGOROUS],
    },
    description: 'Running or jogging outdoors.',
  },
  indoor_walk: {
    id: 'indoor_walk', label: 'Indoor walk',
    environment: 'indoor', exertion: 'moderate',
    demands: {
      weightBearing: 'full', impact: 'low', balance: 'moderate',
      regions: { lower_limb: 1, upper_limb: 0.1, trunk: 0.3 },
      categories: [C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD],
    },
    description: 'Treadmill or indoor-track walking.',
  },
  stationary_cycling: {
    id: 'stationary_cycling', label: 'Stationary cycling',
    environment: 'indoor', exertion: 'moderate',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0.9, upper_limb: 0.1, trunk: 0.3 },
      categories: [C.LOWER_LIMB_LOAD],
    },
    description: 'Seated cycling — supported, non-weight-bearing.',
  },
  recumbent_cycling: {
    id: 'recumbent_cycling', label: 'Recumbent cycling',
    environment: 'indoor', exertion: 'light',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0.8, upper_limb: 0.05, trunk: 0.2 },
      categories: [C.LOWER_LIMB_LOAD],
    },
    description: 'Fully supported recumbent cycling.',
  },
  upper_body_ergometer: {
    id: 'upper_body_ergometer', label: 'Upper-body ergometer',
    environment: 'indoor', exertion: 'moderate',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0, upper_limb: 1, trunk: 0.2 },
      categories: [C.UPPER_LIMB_LOAD],
    },
    description: 'Arm crank / upper-body cardio.',
  },
  upper_body_strength: {
    id: 'upper_body_strength', label: 'Seated upper-body strength',
    environment: 'indoor', exertion: 'moderate',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0, upper_limb: 1, trunk: 0.3 },
      categories: [C.UPPER_LIMB_LOAD],
    },
    description: 'Seated resistance work for the upper body.',
  },
  strength_training: {
    id: 'strength_training', label: 'Strength training',
    environment: 'either', exertion: 'moderate',
    demands: {
      weightBearing: 'partial', impact: 'low', balance: 'moderate',
      regions: { lower_limb: 0.6, upper_limb: 0.8, trunk: 0.6 },
      categories: [C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD, C.UPPER_LIMB_LOAD, C.TRUNK_LOAD, C.VALSALVA],
    },
    description: 'Mixed resistance training (some standing).',
  },
  swimming: {
    id: 'swimming', label: 'Swimming',
    environment: 'water', exertion: 'moderate',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0.6, upper_limb: 0.9, trunk: 0.6 },
      categories: [C.WATER_IMMERSION, C.LOWER_LIMB_LOAD, C.UPPER_LIMB_LOAD],
    },
    description: 'Pool swimming — non-weight-bearing, immersion required.',
  },
  gentle_mobility: {
    id: 'gentle_mobility', label: 'Gentle mobility',
    environment: 'either', exertion: 'light',
    demands: {
      weightBearing: 'partial', impact: 'low', balance: 'moderate',
      regions: { lower_limb: 0.4, upper_limb: 0.4, trunk: 0.5 },
      categories: [C.BALANCE_CHALLENGING],
    },
    description: 'Light stretching and range-of-motion work.',
  },
  seated_movement: {
    id: 'seated_movement', label: 'Seated movement',
    environment: 'indoor', exertion: 'light',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0.2, upper_limb: 0.5, trunk: 0.3 },
      // Chair-based work still loads the arms and trunk — it is the last-resort
      // candidate, not a universally-eligible one: documented upper_limb_load
      // or trunk_load prohibitions can and do restrict it.
      categories: [C.UPPER_LIMB_LOAD, C.TRUNK_LOAD],
    },
    description: 'Chair-based gentle movement.',
  },
  group_fitness_class: {
    id: 'group_fitness_class', label: 'Group fitness class (indoor)',
    environment: 'indoor', exertion: 'moderate',
    demands: {
      weightBearing: 'full', impact: 'moderate', balance: 'high',
      regions: { lower_limb: 0.9, upper_limb: 0.5, trunk: 0.5 },
      categories: [C.GROUP_INDOOR, C.WEIGHT_BEARING_LOWER, C.LOWER_LIMB_LOAD, C.UPPER_LIMB_LOAD, C.IMPACT, C.BALANCE_CHALLENGING],
    },
    description: 'Instructor-led indoor group class (aerobics/dance/circuit style). Shared-space exposure; choreography can include impact and rapid direction changes. Indoor location is not a safety credential — it only removes weather exposure.',
  },
  rest: {
    id: 'rest', label: 'Rest',
    environment: 'either', exertion: 'light',
    demands: {
      weightBearing: 'none', impact: 'low', balance: 'low',
      regions: { lower_limb: 0, upper_limb: 0, trunk: 0 },
      categories: [],
    },
    description: 'Recovery — always a valid choice.',
  },
};

function getActivity(id) { return ACTIVITIES[id] || null; }
function listActivities() { return Object.values(ACTIVITIES); }

module.exports = { ACTIVITIES, getActivity, listActivities };

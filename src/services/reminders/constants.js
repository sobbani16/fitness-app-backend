const CATEGORIES = [
  'meal:breakfast', 'meal:lunch', 'meal:dinner', 'meal:snack',
  'water', 'supplement', 'workout', 'movement',
];

const DEFAULTS = {
  dailyCap: 3,
  snoozeMinutes: 30,
  waterIntervalMinutes: 120,
  movementIntervalMinutes: 90,
  mealDelayMinutes: 30,
  workoutLeadMinutes: 30,
};

const SNOOZE_OPTIONS = [15, 30, 60];
const MIN_OBSERVATIONS = 3;
const CATEGORY_COOLDOWN_MINUTES = 60;
const INSTANCE_EXPIRY_HOURS = 12;

const TERMINAL_STATUSES = ['completed', 'dismissed', 'skipped', 'expired'];

const SUPPRESS = {
  NOT_OPTED_IN: 'not_opted_in',
  CATEGORY_DISABLED: 'category_disabled',
  ADAPTIVE_NOT_CONSENTED: 'adaptive_not_consented',
  PAUSED: 'paused',
  QUIET_HOURS: 'quiet_hours',
  SLEEPING: 'sleeping',
  ACTIVE_WORKOUT: 'active_workout',
  ALREADY_DONE: 'already_completed',
  SNOOZED: 'snoozed',
  DUPLICATE: 'duplicate',
  DAILY_CAP: 'daily_cap',
  COOLDOWN: 'cooldown',
  STALE_DATA: 'stale_data',
};

module.exports = { CATEGORIES, DEFAULTS, SNOOZE_OPTIONS, MIN_OBSERVATIONS, CATEGORY_COOLDOWN_MINUTES, INSTANCE_EXPIRY_HOURS, TERMINAL_STATUSES, SUPPRESS };

const { CATEGORIES, DEFAULTS, SNOOZE_OPTIONS } = require('./constants');
const { parseHHMM } = require('./time');

const PREF_FIELDS = ['masterEnabled', 'adaptiveEnabled', 'suggestionsMuted', 'quietStart', 'quietEnd', 'dailyCap', 'snoozeMinutes', 'pausedUntil', 'weeklyDigest', 'timezone', 'timezoneLocked'];

function defaults(userId) {
  return {
    userId,
    masterEnabled: false,
    adaptiveEnabled: false,
    suggestionsMuted: false,
    quietStart: null,
    quietEnd: null,
    dailyCap: DEFAULTS.dailyCap,
    snoozeMinutes: DEFAULTS.snoozeMinutes,
    pausedUntil: null,
    weeklyDigest: false,
    timezone: null,
    timezoneLocked: false,
  };
}

function validatePrefs(patch) {
  const clean = {};
  for (const key of PREF_FIELDS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === 'dailyCap') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error('dailyCap must be an integer 0-20');
      clean[key] = n;
    } else if (key === 'snoozeMinutes') {
      const n = Number(value);
      if (!SNOOZE_OPTIONS.includes(n)) throw new Error(`snoozeMinutes must be one of ${SNOOZE_OPTIONS.join('/')}`);
      clean[key] = n;
    } else if (key === 'quietStart' || key === 'quietEnd') {
      if (value != null && parseHHMM(value) == null) throw new Error(`${key} must be HH:MM`);
      clean[key] = value;
    } else if (key === 'timezone') {
      if (value != null) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: value }); } catch { throw new Error('timezone must be a valid IANA name'); }
      }
      clean[key] = value;
    } else if (key === 'pausedUntil') {
      clean[key] = value ? new Date(value) : null;
      if (clean[key] && Number.isNaN(clean[key].getTime())) throw new Error('pausedUntil must be a date');
    } else {
      clean[key] = Boolean(value);
    }
  }
  return clean;
}

function validateCategory(category, patch) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  const clean = {};
  if ('enabled' in patch) clean.enabled = Boolean(patch.enabled);
  if ('times' in patch) {
    const times = Array.isArray(patch.times) ? patch.times : [];
    if (times.length > 6) throw new Error('At most 6 times per category');
    for (const t of times) if (parseHHMM(t) == null) throw new Error('times must be HH:MM strings');
    clean.times = [...new Set(times)].sort();
  }
  if ('daysOfWeek' in patch) {
    const days = patch.daysOfWeek;
    if (days != null && (!Array.isArray(days) || days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error('daysOfWeek must be integers 0-6');
    clean.daysOfWeek = days;
  }
  if ('intervalMinutes' in patch) {
    const n = Number(patch.intervalMinutes);
    if (!Number.isInteger(n)) throw new Error('intervalMinutes must be an integer');
    if (category === 'movement' && (n < 60 || n > 120)) throw new Error('movement interval must be 60-120 minutes');
    if (category === 'water' && (n < 30 || n > 720)) throw new Error('water interval must be 30-720 minutes');
    clean.intervalMinutes = n;
  }
  if ('leadMinutes' in patch) {
    const n = Number(patch.leadMinutes);
    if (![15, 30, 60].includes(n)) throw new Error('leadMinutes must be 15, 30 or 60');
    clean.leadMinutes = n;
  }
  for (const key of ['wakingStart', 'wakingEnd']) {
    if (key in patch) {
      if (patch[key] != null && parseHHMM(patch[key]) == null) throw new Error(`${key} must be HH:MM`);
      clean[key] = patch[key];
    }
  }
  return clean;
}

async function getPreferences(prisma, userId) {
  const row = await prisma.reminderPreference.findUnique({ where: { userId } });
  return row || defaults(userId);
}

async function updatePreferences(prisma, userId, patch) {
  const data = validatePrefs(patch);
  return prisma.reminderPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

async function listCategories(prisma, userId) {
  const rows = await prisma.reminderCategorySetting.findMany({ where: { userId } });
  const byCategory = Object.fromEntries(rows.map(r => [r.category, r]));
  return CATEGORIES.map(category => byCategory[category] || { userId, category, enabled: false, times: [], daysOfWeek: null, intervalMinutes: null, leadMinutes: null, source: 'manual' });
}

async function updateCategory(prisma, userId, category, patch) {
  const data = validateCategory(category, patch);
  // User edits always make the schedule manual — user-configured wins over adaptive.
  data.source = 'manual';
  return prisma.reminderCategorySetting.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, ...data },
    update: data,
  });
}

async function pauseAll(prisma, userId, minutes) {
  const until = minutes ? new Date(Date.now() + minutes * 60000) : null;
  return updatePreferences(prisma, userId, { pausedUntil: until });
}

// Revoking adaptive consent immediately stops adaptive automation: pending
// suggestions expire and adaptive-sourced schedules turn off (config kept for audit).
async function revokeAdaptive(prisma, userId) {
  await updatePreferences(prisma, userId, { adaptiveEnabled: false });
  await prisma.reminderSuggestion.updateMany({ where: { userId, status: 'pending' }, data: { status: 'expired', resolvedAt: new Date() } });
  await prisma.reminderCategorySetting.updateMany({ where: { userId, source: 'adaptive' }, data: { enabled: false } });
}

// Opt out of future suggestions; pending ones expire. Re-enable via preferences.
async function muteSuggestions(prisma, userId) {
  await updatePreferences(prisma, userId, { suggestionsMuted: true });
  await prisma.reminderSuggestion.updateMany({ where: { userId, status: 'pending' }, data: { status: 'expired', resolvedAt: new Date() } });
}

// Clears learned patterns without touching manual schedules.
async function resetLearned(prisma, userId) {
  await prisma.reminderSuggestion.updateMany({ where: { userId, status: 'pending' }, data: { status: 'expired', resolvedAt: new Date() } });
  await prisma.reminderCategorySetting.updateMany({ where: { userId, source: 'adaptive' }, data: { enabled: false, source: 'manual' } });
}

async function acceptSuggestion(prisma, userId, suggestionId) {
  const suggestion = await prisma.reminderSuggestion.findUnique({ where: { id: suggestionId } });
  if (!suggestion || suggestion.userId !== userId) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error(`Suggestion is ${suggestion.status}`);
  const prefs = await getPreferences(prisma, userId);
  if (!prefs.adaptiveEnabled) throw new Error('Adaptive reminders are not enabled');
  const proposed = suggestion.proposed || {};
  const current = await prisma.reminderCategorySetting.findUnique({ where: { userId_category: { userId, category: suggestion.category } } });
  // User-configured manual schedules always take precedence over suggestions.
  if (current && current.source === 'manual' && current.enabled && Array.isArray(current.times) && current.times.length) {
    throw new Error('A manual schedule already exists for this category');
  }
  const setting = await prisma.reminderCategorySetting.upsert({
    where: { userId_category: { userId, category: suggestion.category } },
    create: { userId, category: suggestion.category, enabled: true, source: 'adaptive', times: proposed.times || [], daysOfWeek: proposed.daysOfWeek ?? null, intervalMinutes: proposed.intervalMinutes ?? null, leadMinutes: proposed.delayMinutes ?? null },
    update: { enabled: true, source: 'adaptive', times: proposed.times || [], daysOfWeek: proposed.daysOfWeek ?? null, intervalMinutes: proposed.intervalMinutes ?? null, leadMinutes: proposed.delayMinutes ?? null },
  });
  await prisma.reminderSuggestion.update({ where: { id: suggestionId }, data: { status: 'accepted', resolvedAt: new Date() } });
  return setting;
}

async function declineSuggestion(prisma, userId, suggestionId, { mute = false } = {}) {
  const suggestion = await prisma.reminderSuggestion.findUnique({ where: { id: suggestionId } });
  if (!suggestion || suggestion.userId !== userId) throw new Error('Suggestion not found');
  const updated = suggestion.status === 'pending'
    ? await prisma.reminderSuggestion.update({ where: { id: suggestionId }, data: { status: 'declined', resolvedAt: new Date() } })
    : suggestion;
  if (mute) await muteSuggestions(prisma, userId);
  return updated;
}

module.exports = {
  defaults, getPreferences, updatePreferences, listCategories, updateCategory,
  pauseAll, revokeAdaptive, muteSuggestions, resetLearned,
  acceptSuggestion, declineSuggestion, validatePrefs, validateCategory,
};

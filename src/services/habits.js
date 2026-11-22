// Habit coaching v1 — user-selected habits, complete/skip/snooze/pause.
// No streak punishment; missed days are absence of records, not failure.
const { getPrisma } = require('../lib/prisma');

const KINDS = ['fiber', 'workout', 'sleep_window', 'meal_prep', 'movement_break', 'reflection', 'supplement', 'custom'];
const OUTCOMES = ['done', 'skipped'];

function todayStr(tz = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dayBit(tz = 'UTC') {
  const wd = new Date(`${todayStr(tz)}T12:00:00Z`).getUTCDay(); // Mon=1..Sun=0
  return 1 << ((wd + 6) % 7);
}

async function listHabits(userId, tz) {
  const prisma = getPrisma();
  const now = new Date();
  const [habits, completions] = await Promise.all([
    prisma.habit.findMany({ where: { userId, status: { not: 'archived' } }, orderBy: { createdAt: 'asc' } }),
    prisma.habitCompletion.findMany({ where: { habit: { userId }, day: todayStr(tz) }, select: { habitId: true, outcome: true } }),
  ]);
  const doneMap = Object.fromEntries(completions.map(c => [c.habitId, c.outcome]));
  const bit = dayBit(tz);
  return {
    version: 'habits-v1', day: todayStr(tz),
    habits: habits.map(h => ({
      id: h.id, title: h.title, kind: h.kind, status: h.status,
      scheduledToday: h.status === 'active' && !(h.snoozedUntil && h.snoozedUntil > now) && (h.daysOfWeek & bit) !== 0,
      todayOutcome: doneMap[h.id] || null,
      snoozedUntil: h.snoozedUntil,
    })),
    note: 'Missed days are unmarked records, not failures.',
  };
}

async function createHabit(userId, { title, kind = 'custom', daysOfWeek = 127 }) {
  if (!title?.trim() || title.length > 120) { const e = new Error('title required (≤120 chars)'); e.status = 400; throw e; }
  if (!KINDS.includes(kind)) { const e = new Error(`kind must be one of ${KINDS.join(', ')}`); e.status = 400; throw e; }
  if (!Number.isInteger(daysOfWeek) || daysOfWeek < 1 || daysOfWeek > 127) { const e = new Error('daysOfWeek must be a 1–127 bitmask'); e.status = 400; throw e; }
  return getPrisma().habit.create({ data: { userId, title: title.trim(), kind, daysOfWeek } });
}

async function updateHabit(userId, id, patch) {
  const allowed = (({ title, kind, daysOfWeek, status, snoozedUntil }) => ({ title, kind, daysOfWeek, status, snoozedUntil }))(patch);
  const data = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined));
  if (data.status && !['active', 'paused', 'archived'].includes(data.status)) { const e = new Error('invalid status'); e.status = 400; throw e; }
  if (data.snoozedUntil) data.snoozedUntil = new Date(data.snoozedUntil);
  const r = await getPrisma().habit.updateMany({ where: { id, userId }, data });
  if (!r.count) { const e = new Error('Habit not found'); e.status = 404; throw e; }
  return { ok: true };
}

async function recordOutcome(userId, id, outcome, tz) {
  if (!OUTCOMES.includes(outcome)) { const e = new Error('outcome must be done|skipped'); e.status = 400; throw e; }
  const prisma = getPrisma();
  const habit = await prisma.habit.findFirst({ where: { id, userId }, select: { id: true } });
  if (!habit) { const e = new Error('Habit not found'); e.status = 404; throw e; }
  return prisma.habitCompletion.upsert({
    where: { habitId_day: { habitId: id, day: todayStr(tz) } },
    update: { outcome },
    create: { habitId: id, day: todayStr(tz), outcome },
  });
}

module.exports = { listHabits, createHabit, updateHabit, recordOutcome, KINDS };

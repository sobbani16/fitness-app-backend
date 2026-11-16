// Mind & Habits service — opt-in emotional wellness. Non-diagnostic by design:
// no mood inference from wearables, no clinical claims, journals are private.
const { getPrisma } = require('../lib/prisma');
// Lazy accessor — resolves getPrisma() per call so tests can swap the client.
const prisma = new Proxy({}, { get: (_t, prop) => getPrisma()[prop] });

const MOODS = ['very_low', 'low', 'neutral', 'good', 'very_good'];
const MOOD_SCORE = { very_low: 1, low: 2, neutral: 3, good: 4, very_good: 5 };
const CONTEXT_TAGS = ['work', 'family', 'exercise', 'sleep', 'relationships', 'other'];

// Original Humai content — educational framework adapted from Goleman's
// emotional-intelligence domains (Goleman, 1995). Not a validated assessment.
const TRACKS = [
  {
    key: 'self_awareness', title: 'Self-awareness',
    description: 'Notice what you feel, when, and why.',
    lessons: [
      { key: 'sa-name', title: 'Name it to tame it', body: 'Putting a precise word on a feeling reduces its grip. "I feel anxious about tomorrow" is more workable than a vague bad mood.', exercise: 'Pause once today and name the strongest emotion you felt. Just naming it counts.' },
      { key: 'sa-trigger', title: 'Spot the trigger', body: 'Moods rarely appear from nowhere. A meeting, a meal, a short night — triggers repeat, and noticing them is the first step.', exercise: 'Recall a recent mood shift. What happened just before it?' },
      { key: 'sa-patterns', title: 'Your decision patterns', body: 'We decide differently when tired, rushed, or stressed. Recognizing your pattern lets you delay big decisions to better moments.', exercise: 'Think of a decision you made while stressed. Would rested-you decide the same?' },
    ],
  },
  {
    key: 'self_management', title: 'Self-management',
    description: 'Work with your reactions instead of against them.',
    lessons: [
      { key: 'sm-breath', title: 'Two-minute breathing', body: 'Slow exhales activate the parasympathetic nervous system — a simple, portable way to downshift. A wellbeing tool, not a treatment.', exercise: 'Breathe in for 4, out for 6, for two minutes. Notice the difference.' },
      { key: 'sm-pause', title: 'The pause before reacting', body: 'The gap between trigger and response is where choice lives. Even one breath creates that gap.', exercise: 'Next time you feel a sharp reaction, take one full breath before responding.' },
      { key: 'sm-plan', title: 'Plan your calmer response', body: 'Rehearsing a calm response makes it easier to find in the moment.', exercise: 'Write one sentence you could say next time a recurring situation frustrates you.' },
    ],
  },
  {
    key: 'social_awareness', title: 'Social awareness',
    description: 'Read the room — and the person in front of you.',
    lessons: [
      { key: 'so-listen', title: 'Active listening', body: 'Most of us listen to reply. Active listening means listening to understand — then showing it.', exercise: 'In your next conversation, summarize what the other person said before adding your view.' },
      { key: 'so-perspective', title: 'Perspective-taking', body: 'The same event looks different from another chair. Curiosity beats assumption.', exercise: 'Think of a recent disagreement. Write down the other person\'s most charitable reason.' },
      { key: 'so-context', title: 'Reading emotional context', body: 'Tone, timing, and setting carry as much meaning as words.', exercise: 'Today, notice one person\'s mood before they say how they feel — then check if you were right.' },
    ],
  },
  {
    key: 'relationship_management', title: 'Relationship management',
    description: 'Communicate clearly and repair well.',
    lessons: [
      { key: 'rm-feedback', title: 'Constructive feedback', body: 'Specific, kind, and about the behavior — not the person.', exercise: 'Draft one piece of feedback using "When X happens, I feel Y. Could we try Z?"' },
      { key: 'rm-disagree', title: 'Disagreeing well', body: 'Disagreement handled well builds trust. Attack the problem together, not each other.', exercise: 'Recall a past disagreement. What would "we vs the problem" have sounded like?' },
      { key: 'rm-repair', title: 'Repairing misunderstandings', body: 'Repair attempts — an apology, a clarification, humor — matter more than never rupturing.', exercise: 'Is there a small misunderstanding you could repair this week with one honest sentence?' },
    ],
  },
];

const GUIDED_EXERCISES = [
  { key: 'breathing-2min', trackKey: 'self_management', title: 'Two-minute breathing', durationSec: 120, steps: ['Sit comfortably', 'Inhale 4s through the nose', 'Exhale 6s slowly', 'Repeat for two minutes', 'Notice how your body feels'] },
  { key: 'evening-reflection', trackKey: 'self_awareness', title: 'Evening reflection', durationSec: 180, steps: ['Recall the strongest emotion of the day', 'Name it precisely', 'What triggered it?', 'How did you respond?', 'What would you do the same?'] },
  { key: 'gratitude-note', trackKey: 'relationship_management', title: 'Brief gratitude note', durationSec: 60, steps: ['Think of one person or thing', 'Write one sentence about why', 'Optional: tell them'] },
  { key: 'pause-practice', trackKey: 'self_management', title: 'Pause practice', durationSec: 30, steps: ['Notice a reaction rising', 'One slow breath', 'Choose your response'] },
];

const SUGGESTED_HABITS = [
  { key: 'active-listening', label: 'Practice active listening' },
  { key: 'gratitude', label: 'Write a brief gratitude note' },
  { key: 'notice-trigger', label: 'Notice an emotional trigger' },
  { key: 'breathing-2min', label: 'Two-minute breathing exercise' },
  { key: 'pause-before-react', label: 'Pause before reacting' },
  { key: 'evening-reflection', label: 'Evening reflection' },
  { key: 'movement-break', label: 'Optional movement break' },
  { key: 'difficult-conversation', label: 'Prepare for a difficult conversation' },
];

// --- Preferences -----------------------------------------------------------

async function getPreferences(userId) {
  let prefs = await prisma.userMindPreferences.findUnique({ where: { userId } });
  if (!prefs) prefs = await prisma.userMindPreferences.create({ data: { userId } });
  return prefs;
}

async function updatePreferences(userId, patch) {
  const allowed = ['moduleEnabled', 'remindersEnabled', 'aiJournalConsent', 'checkinSharingConsent'];
  const data = {};
  for (const k of allowed) if (typeof patch[k] === 'boolean') data[k] = patch[k];
  await getPreferences(userId);
  return prisma.userMindPreferences.update({ where: { userId }, data });
}

// --- Check-ins ---------------------------------------------------------------

function validateCheckIn(body) {
  if (!body.mood || !MOODS.includes(body.mood)) return 'mood must be one of: ' + MOODS.join(', ');
  for (const k of ['energy', 'stress']) {
    const v = body[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) return `${k} must be an integer 1-5`;
  }
  for (const k of ['emotionTags', 'contextTags']) {
    if (body[k] !== undefined && !Array.isArray(body[k])) return `${k} must be an array`;
  }
  if (body.journal !== undefined && body.journal !== null && typeof body.journal !== 'string') return 'journal must be a string';
  return null;
}

async function createCheckIn(userId, body, timezone) {
  const err = validateCheckIn(body);
  if (err) { const e = new Error(err); e.status = 400; throw e; }
  const checkins = await prisma.emotionalCheckIn.create({
    data: {
      userId,
      mood: body.mood,
      energy: body.energy,
      stress: body.stress,
      emotionTags: body.emotionTags || [],
      contextTags: (body.contextTags || []).filter((t) => CONTEXT_TAGS.includes(t)),
      journal: body.journal || null,
      timezone: timezone || body.timezone || 'UTC',
      loggedAt: body.loggedAt ? new Date(body.loggedAt) : new Date(),
    },
  });
  return checkins;
}

async function updateCheckIn(userId, id, body) {
  const existing = await prisma.emotionalCheckIn.findFirst({ where: { id, userId } });
  if (!existing) { const e = new Error('Check-in not found'); e.status = 404; throw e; }
  const data = {};
  if (body.mood !== undefined) { if (!MOODS.includes(body.mood)) { const e = new Error('invalid mood'); e.status = 400; throw e; } data.mood = body.mood; }
  for (const k of ['energy', 'stress']) if (body[k] !== undefined) {
    if (!Number.isInteger(body[k]) || body[k] < 1 || body[k] > 5) { const e = new Error(`${k} must be 1-5`); e.status = 400; throw e; }
    data[k] = body[k];
  }
  if (body.emotionTags !== undefined) data.emotionTags = body.emotionTags;
  if (body.contextTags !== undefined) data.contextTags = body.contextTags.filter((t) => CONTEXT_TAGS.includes(t));
  if (body.journal !== undefined) data.journal = body.journal;
  return prisma.emotionalCheckIn.update({ where: { id }, data });
}

async function deleteCheckIn(userId, id) {
  const existing = await prisma.emotionalCheckIn.findFirst({ where: { id, userId } });
  if (!existing) { const e = new Error('Check-in not found'); e.status = 404; throw e; }
  await prisma.emotionalCheckIn.delete({ where: { id } });
}

async function listCheckIns(userId, { days = 30, limit = 100 } = {}) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.emotionalCheckIn.findMany({
    where: { userId, loggedAt: { gte: since } },
    orderBy: { loggedAt: 'desc' },
    take: Math.min(limit, 365),
  });
  // Journals are included for the owner only — this endpoint is user-scoped.
  return rows;
}

// --- Learning content --------------------------------------------------------

function listTracks() {
  return TRACKS.map(({ key, title, description, lessons }) => ({
    key, title, description,
    lessons: lessons.map(({ key: lk, title: lt }) => ({ key: lk, title: lt })),
    lessonCount: lessons.length,
  }));
}

function getTrack(trackKey, completed) {
  const track = TRACKS.find((t) => t.key === trackKey);
  if (!track) { const e = new Error('Track not found'); e.status = 404; throw e; }
  const done = new Set((completed || []).map((c) => c.exerciseKey));
  return {
    ...track,
    attribution: 'Adapted from emotional-intelligence frameworks (Goleman, 1995). Original Humai educational content — not a clinical assessment.',
    lessons: track.lessons.map((l) => ({ ...l, completed: done.has(l.key) })),
  };
}

function listExercises() { return GUIDED_EXERCISES; }
function listSuggestedHabits() { return SUGGESTED_HABITS; }

async function completeExercise(userId, exerciseKey, reflection) {
  const ex = GUIDED_EXERCISES.find((x) => x.key === exerciseKey)
    || TRACKS.flatMap((t) => t.lessons.map((l) => ({ ...l, trackKey: t.key }))).find((l) => l.key === exerciseKey);
  if (!ex) { const e = new Error('Exercise not found'); e.status = 404; throw e; }
  return prisma.mindExerciseCompletion.create({
    data: { userId, exerciseKey, trackKey: ex.trackKey, reflection: reflection || null },
  });
}

async function listCompletions(userId) {
  return prisma.mindExerciseCompletion.findMany({ where: { userId }, orderBy: { completedAt: 'desc' } });
}

// --- Insights (descriptive associations only — minimum thresholds, no causality) ---

const MIN_OBSERVATIONS = 10; // below this, no personal association is shown

async function getInsights(userId, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 864e5);
  const checkins = await prisma.emotionalCheckIn.findMany({
    where: { userId, loggedAt: { gte: since } },
    select: { loggedAt: true, mood: true, energy: true, stress: true },
    orderBy: { loggedAt: 'asc' },
  });

  const base = {
    windowDays: days,
    checkinCount: checkins.length,
    minObservations: MIN_OBSERVATIONS,
    insights: [],
    attribution: 'Observed associations in your own records. Correlation is not causation.',
  };
  if (checkins.length < MIN_OBSERVATIONS) {
    return { ...base, dataQuality: 'insufficient', insights: [] };
  }

  // Sleep ↔ mood/energy: join check-in days to SleepLog days
  const sleeps = await prisma.sleepLog.findMany({
    where: { userId, sleepEnd: { gte: since } },
    select: { sleepEnd: true, hoursSlept: true },
  });
  const sleepByDay = new Map(sleeps.map((s) => [s.sleepEnd.toISOString().slice(0, 10), (s.hoursSlept || 0) * 60]));
  const withSleep = checkins.filter((c) => sleepByDay.has(c.loggedAt.toISOString().slice(0, 10)));
  const insights = [];

  if (withSleep.length >= MIN_OBSERVATIONS) {
    const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const medSleep = median(withSleep.map((c) => sleepByDay.get(c.loggedAt.toISOString().slice(0, 10))));
    const longer = withSleep.filter((c) => sleepByDay.get(c.loggedAt.toISOString().slice(0, 10)) >= medSleep);
    const shorter = withSleep.filter((c) => sleepByDay.get(c.loggedAt.toISOString().slice(0, 10)) < medSleep);
    const avg = (arr, f) => arr.length ? arr.reduce((s, c) => s + f(c), 0) / arr.length : 0;
    const energyLong = avg(longer, (c) => c.energy);
    const energyShort = avg(shorter, (c) => c.energy);
    const moodLong = avg(longer, (c) => MOOD_SCORE[c.mood]);
    const moodShort = avg(shorter, (c) => MOOD_SCORE[c.mood]);
    if (energyLong - energyShort >= 0.4) {
      insights.push({
        type: 'sleep_energy',
        statement: `Across ${withSleep.length} check-ins over the past ${days} days, you reported higher energy more often after longer recorded sleep.`,
        sampleSize: withSleep.length, confidence: 'low', causal: false,
      });
    }
    if (moodLong - moodShort >= 0.4) {
      insights.push({
        type: 'sleep_mood',
        statement: `On days after longer recorded sleep, your check-ins trended toward better mood (${withSleep.length} observations, ${days} days).`,
        sampleSize: withSleep.length, confidence: 'low', causal: false,
      });
    }
  }

  // Activity ↔ stress: join to workout days
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, finishedAt: { gte: since } }, select: { finishedAt: true },
  });
  const workoutDays = new Set(sessions.map((s) => s.finishedAt.toISOString().slice(0, 10)));
  const withAct = checkins.filter((c) => workoutDays.size > 0);
  if (withAct.length >= MIN_OBSERVATIONS && workoutDays.size >= 5) {
    const onWorkout = withAct.filter((c) => workoutDays.has(c.loggedAt.toISOString().slice(0, 10)));
    const offWorkout = withAct.filter((c) => !workoutDays.has(c.loggedAt.toISOString().slice(0, 10)));
    const avg = (arr, f) => arr.length ? arr.reduce((s, c) => s + f(c), 0) / arr.length : 0;
    const diff = avg(onWorkout, (c) => c.stress) - avg(offWorkout, (c) => c.stress);
    if (Math.abs(diff) >= 0.4) {
      insights.push({
        type: 'activity_stress',
        statement: diff < 0
          ? `Your stress check-ins trended lower on days with a logged workout (${withAct.length} check-ins).`
          : `Your stress check-ins trended higher on days with a logged workout (${withAct.length} check-ins).`,
        sampleSize: withAct.length, confidence: 'low', causal: false,
      });
    }
  }

  // Rest days ↔ stress and workout-frequency ↔ energy
  if (checkins.length >= MIN_OBSERVATIONS) {
    const avg = (arr, f) => arr.length ? arr.reduce((x, c) => x + f(c), 0) / arr.length : 0;
    const wk = checkins.map((c) => ({ c, d: c.loggedAt.toISOString().slice(0, 10) }));
    const onW = wk.filter((x) => workoutDays.has(x.d));
    const offW = wk.filter((x) => !workoutDays.has(x.d));
    if (workoutDays.size >= 3 && offW.length >= MIN_OBSERVATIONS / 2 && onW.length >= 3) {
      const eOn = avg(onW, (x) => x.c.energy), eOff = avg(offW, (x) => x.c.energy);
      if (Math.abs(eOn - eOff) >= 0.4) {
        insights.push({ type: 'workout_energy', statement: eOn > eOff
          ? `On days with a logged workout your energy check-ins trended higher (${wk.length} check-ins).`
          : `On days with a logged workout your energy check-ins trended lower (${wk.length} check-ins).`,
          sampleSize: wk.length, confidence: 'low', causal: false });
      }
      if (offW.length >= MIN_OBSERVATIONS / 2 && !insights.some((i) => i.type === 'activity_stress')) {
        const sOff = avg(offW, (x) => x.c.stress);
        const sAll = avg(wk, (x) => x.c.stress);
        if (Math.abs(sAll - sOff) >= 0.4) {
          insights.push({ type: 'restday_stress', statement: sOff > sAll
            ? `Your stress check-ins trended higher on rest days across ${offW.length} non-workout days.`
            : `Your stress check-ins trended lower on rest days across ${offW.length} non-workout days.`,
            sampleSize: offW.length, confidence: 'low', causal: false });
        }
      }
    }
  }

  // Habit completion ↔ self-reported well-being
  const habits = await prisma.habitCompletion.findMany({
    where: { habit: { userId }, day: { gte: since } },
    select: { day: true },
  }).catch(() => []);
  if (habits.length >= 5) {
    const habitDays = new Set(habits.map((h) => h.day.toISOString().slice(0, 10)));
    const avg = (arr, f) => arr.length ? arr.reduce((x, c) => x + f(c), 0) / arr.length : 0;
    const onH = checkins.filter((c) => habitDays.has(c.loggedAt.toISOString().slice(0, 10)));
    const offH = checkins.filter((c) => !habitDays.has(c.loggedAt.toISOString().slice(0, 10)));
    if (onH.length >= MIN_OBSERVATIONS / 2 && offH.length >= MIN_OBSERVATIONS / 2) {
      const mOn = avg(onH, (c) => MOOD_SCORE[c.mood]), mOff = avg(offH, (c) => MOOD_SCORE[c.mood]);
      if (Math.abs(mOn - mOff) >= 0.4) {
        insights.push({ type: 'habit_wellbeing', statement: mOn > mOff
          ? `On days you completed a chosen habit, your check-ins trended toward better mood (${onH.length + offH.length} check-ins).`
          : `On days you completed a chosen habit, your check-ins trended toward lower mood (${onH.length + offH.length} check-ins).`,
          sampleSize: onH.length + offH.length, confidence: 'low', causal: false });
      }
    }
  }

  return { ...base, dataQuality: 'ok', insights };
}

// Leo helper: deterministic supportive options — never a diagnosis.
function leoSuggestions(text) {
  const t = (text || '').toLowerCase();
  const out = [];
  if (/\b(stress|stressed|anxious|overwhelm|tense)\b/.test(t)) {
    out.push({ action: 'breathing', label: 'Try a 2-minute breathing exercise', exerciseKey: 'breathing-2min' });
    out.push({ action: 'journal', label: "Write down what's on your mind" });
    out.push({ action: 'lighter_workout', label: "Consider a lighter workout today" });
  }
  if (/\b(sad|down|low|blue|unhappy)\b/.test(t)) {
    out.push({ action: 'checkin', label: 'Log how you feel in a quick check-in' });
    out.push({ action: 'gratitude', label: 'Try a brief gratitude note', exerciseKey: 'gratitude-note' });
  }
  if (/\binterrupt/.test(t)) {
    out.push({ action: 'exercise', label: 'Practice summarizing before replying', exerciseKey: 'so-listen' });
  }
  if (/\b(crisis|self.?harm|suicid|hurt myself|end it)\b/.test(t)) {
    return { crisis: true, message: 'If you\'re in distress, please reach out to a local crisis line or emergency services. Humai can\'t provide crisis support, but help is available.', suggestions: [] };
  }
  return { crisis: false, suggestions: out };
}

module.exports = {
  MOODS, CONTEXT_TAGS, TRACKS, GUIDED_EXERCISES, SUGGESTED_HABITS,
  getPreferences, updatePreferences,
  createCheckIn, updateCheckIn, deleteCheckIn, listCheckIns,
  listTracks, getTrack, listExercises, listSuggestedHabits,
  completeExercise, listCompletions, getInsights, leoSuggestions,
};

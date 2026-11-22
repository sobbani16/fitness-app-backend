const express = require('express');
const { getPrisma } = require('../lib/prisma');
const safety = require('../services/activitySafety');
const { SYMPTOMS_URGENT, BODY_REGIONS } = require('../services/activitySafety/constants');
const flags = require('../services/featureFlags/service');
const { parseTranscript } = require('../services/voice/voiceParser');
const { aiEnabled, askJSON } = require('../services/aiProvider');
const ingredientNutrition = require('../services/ingredientNutrition');
const httpError = require('../lib/errors').httpError;

const router = express.Router();
const { requireAnyFeature } = require('../middleware/requireFeature');
const voiceEnabled = requireAnyFeature('voice_food_logging', 'voice_exercise_logging');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const uid = req => (req.userId || req.headers['x-user-id'] || '').toString().trim();
const UNDO_WINDOW_MS = 15 * 60 * 1000;

// Resolve an exercise name against the canonical library — server-side only.
const resolveExercise = async (prisma, name) => {
  if (!name) return [];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return prisma.exercise.findMany({
    where: { OR: [{ normalizedName: slug }, { name: { contains: name, mode: 'insensitive' } }] },
    select: { id: true, name: true, equipment: true, level: true },
    take: 5,
  });
};

const resolveIngredient = (prisma, name) =>
  prisma.ingredient.findFirst({
    where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { name: { contains: name, mode: 'insensitive' } }] },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

// Resolve a spoken quantity+unit ("2 slices") against the ingredient's catalog
// servings — shared by interpret (readiness) and execute (conversion). Returns
// { grams, servingId, label, count } or null when no serving matches.
const resolveHouseholdServing = async (prisma, ingId, quantity, unit) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1000) return null;
  const full = await ingredientNutrition.getIngredient(ingId, prisma);
  const unitNorm = String(unit || '').toLowerCase().replace(/s$/, '').trim();
  const srv = (full.servings || []).find(s => String(s.label).toLowerCase().replace(/^\d+(\.\d+)?\s*/, '').replace(/s$/, '').trim() === unitNorm)
    || (['serving', 'portion', ''].includes(unitNorm) ? (full.servings || [])[0] : null);
  if (!srv) return null;
  return { grams: srv.grams * qty, servingId: srv.id, label: srv.label, count: qty };
};

// Reverses one command's writes. createdEntities entries may carry `prev`
// state for in-place updates so undo restores rather than deletes.
const applyUndo = async (prisma, cmd) => {
  for (const e of cmd.createdEntities) {
    if (e.kind === 'water') await prisma.waterLog.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    if (e.kind === 'foodLog') await prisma.foodLog.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    if (e.kind === 'emotionalCheckIn') await prisma.emotionalCheckIn.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    if (e.kind === 'supplementLog') await prisma.supplementLog.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    if (e.kind === 'workoutSession') {
      await prisma.exerciseSet.deleteMany({ where: { workoutSessionId: e.id } });
      await prisma.workoutSession.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    }
    if (e.kind === 'exerciseSetUpdate') await prisma.exerciseSet.updateMany({
      where: { id: e.id, workoutSession: { userId: cmd.userId } }, data: { reps: e.prev.reps },
    });
    if (e.kind === 'workoutSessionComplete') await prisma.workoutSession.updateMany({
      where: { id: e.id, userId: cmd.userId },
      data: { finishedAt: e.prev.finishedAt, endedAt: e.prev.endedAt, durationMinutes: e.prev.durationMinutes },
    });
    if (e.kind === 'userInjury') await prisma.userInjury.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    if (e.kind === 'symptomReport') await prisma.userSymptomReport.deleteMany({ where: { id: e.id, userId: cmd.userId } });
  }
};

// Map a spoken workout type to the closest catalog activity for a safety
// pre-check. Falls back to strength_training (the most general demand).
const workoutActivityId = name => {
  const n = String(name || '').toLowerCase();
  if (/run|jog/.test(n)) return 'outdoor_run';
  if (/walk|hike/.test(n)) return 'outdoor_walk';
  if (/cycl|bike|spin/.test(n)) return 'stationary_cycling';
  if (/swim/.test(n)) return 'swimming';
  if (/stretch|mobility|yoga/.test(n)) return 'gentle_mobility';
  return 'strength_training';
};

// POST /voice/transcribe — audio → text. Returns 503 until a provider is
// configured; body: { audio: base64, format }. Audio is never persisted.
router.post('/transcribe', voiceEnabled, wrap(async (req, res) => {
  const { audio } = req.body || {};
  if (typeof audio !== 'string' || !audio.length) throw httpError(400, 'audio (base64) required');
  if (audio.length > 4_000_000) throw httpError(413, 'Audio too large — keep clips under ~30 seconds.');
  if (!aiEnabled() || !process.env.OPENAI_API_KEY?.trim()) throw httpError(503, 'Voice transcription is not configured.');
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const buf = Buffer.from(audio, 'base64');
  const file = new (require('buffer').File)([buf], 'clip.m4a', { type: 'audio/m4a' });
  const out = await client.audio.transcriptions.create({
    file, model: process.env.VOICE_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  });
  res.json({ transcript: out.text || '' });
}));

// AI fallback for segments the deterministic parser can't classify. The model
// proposes candidate fields only — everything is re-validated and resolved
// server-side; it can never emit an ID or execute anything.
const VOICE_INTENTS = ['LOG_EXERCISE_SET', 'LOG_FOOD', 'LOG_WATER', 'MARK_SUPPLEMENT_TAKEN',
  'UPDATE_EXERCISE_SET', 'START_WORKOUT', 'COMPLETE_WORKOUT', 'LOG_MOOD', 'START_BREATHING_EXERCISE', 'SHOW_MOOD_TRENDS', 'CREATE_REFLECTION_REMINDER', 'ASK_FIBER', 'UNDO_ACTION', 'CANCEL_COMMAND', 'UNKNOWN_INTENT'];

const NULLABLE = { type: ['number', 'null'] };
const NULLABLE_STR = { type: ['string', 'null'] };
const INTENT_SCHEMA = {
  actions: {
    type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        intent: { type: 'string', enum: VOICE_INTENTS }, segment: { type: 'string' },
        exerciseName: NULLABLE_STR, sets: NULLABLE, reps: NULLABLE, weight: NULLABLE, weightUnit: NULLABLE_STR,
        amountMl: NULLABLE, mealType: NULLABLE_STR, name: NULLABLE_STR, mood: NULLABLE_STR, energy: NULLABLE, stress: NULLABLE,
        items: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { name: { type: 'string' }, grams: NULLABLE, quantity: NULLABLE, unit: NULLABLE_STR },
            required: ['name', 'grams', 'quantity', 'unit'],
          },
        },
      },
      required: ['intent', 'segment', 'exerciseName', 'sets', 'reps', 'weight', 'weightUnit', 'amountMl', 'mealType', 'name', 'items', 'mood', 'energy', 'stress'],
    },
  },
};
const INTENT_INSTRUCTIONS = `You convert short voice commands from a fitness logging app into structured actions, one action per numbered input segment.
Intents: LOG_EXERCISE_SET (add sets/reps/weight of an exercise), LOG_FOOD (food items; split every distinct food), LOG_WATER (water amount), MARK_SUPPLEMENT_TAKEN, UPDATE_EXERCISE_SET (change the most recent set), START_WORKOUT, COMPLETE_WORKOUT, LOG_MOOD (record how the user feels: mood one of very_low|low|neutral|good|very_good, energy 1-5, stress 1-5), START_BREATHING_EXERCISE (open the breathing exercise), SHOW_MOOD_TRENDS (open mood trends/insights), CREATE_REFLECTION_REMINDER (enable the optional evening reflection reminder in Mind preferences), ASK_FIBER (a question about dietary fiber, fiber in foods, or fiber supplements — informational only, never a logging action), UNDO_ACTION, CANCEL_COMMAND, UNKNOWN_INTENT (not a logging command).
Rules: never invent IDs or foods not mentioned; keep weightUnit as "lbs" or "kg"; water amounts in ml; food grams only when the user gives a weight (e.g. "150 g"); household measures go in unit with quantity (e.g. "2 slices" -> quantity 2, unit "slice"); unknown or non-command speech -> UNKNOWN_INTENT. Output exactly one action per input segment, in order, echoing the segment text.`;

const numOrNull = v => Number.isFinite(Number(v)) && v !== null ? Number(v) : null;

// Rebuild an AI-proposed action into the internal shape with the same
// required-field rules the deterministic parser applies.
function aiAction(raw, segment, ctx) {
  const intent = VOICE_INTENTS.includes(raw?.intent) ? raw.intent : 'UNKNOWN_INTENT';
  if (intent === 'UNKNOWN_INTENT') return { intent, entities: {}, missing: ['intent'], segment, status: 'needs_review' };
  const e = {
    exerciseName: raw.exerciseName || null,
    sets: numOrNull(raw.sets), reps: numOrNull(raw.reps),
    weight: numOrNull(raw.weight),
    weightUnit: raw.weightUnit === 'kg' ? 'kg' : 'lbs',
    amountMl: numOrNull(raw.amountMl), mealType: raw.mealType || 'meal',
    name: raw.name || null,
    mood: typeof raw.mood === 'string' ? raw.mood : null,
    energy: numOrNull(raw.energy), stress: numOrNull(raw.stress),
    items: Array.isArray(raw.items) ? raw.items.filter(i => i && typeof i.name === 'string' && i.name.trim())
      .map(i => ({ name: i.name.trim(), grams: numOrNull(i.grams), quantity: numOrNull(i.quantity), unit: typeof i.unit === 'string' ? i.unit : 'servings' })) : [],
  };
  let missing = []; let ready = true;
  if (intent === 'LOG_EXERCISE_SET') {
    missing = [e.exerciseName ? null : 'exercise', e.reps ? null : 'reps'].filter(Boolean);
    ready = Boolean(e.exerciseName && e.reps);
  } else if (intent === 'LOG_WATER') { missing = e.amountMl ? [] : ['amountMl']; ready = Boolean(e.amountMl); }
  else if (intent === 'LOG_FOOD') { const okItem = i => i.grams != null || (i.quantity != null && i.quantity > 0); missing = e.items.length ? (e.items.some(i => !okItem(i)) ? ['grams or quantity'] : []) : ['items']; ready = e.items.length > 0 && e.items.every(okItem); }
  else if (intent === 'MARK_SUPPLEMENT_TAKEN') { missing = e.name ? [] : ['name']; ready = Boolean(e.name); }
  else if (intent === 'UPDATE_EXERCISE_SET') { missing = [e.reps ? null : 'reps', ctx.lastSetId ? null : 'set'].filter(Boolean); ready = Boolean(e.reps && ctx.lastSetId); }
  else if (intent === 'LOG_MOOD') { const ok = ['very_low','low','neutral','good','very_good'].includes(e.mood); missing = ok ? [] : ['mood']; ready = ok; }
  else if (['START_BREATHING_EXERCISE','SHOW_MOOD_TRENDS','CREATE_REFLECTION_REMINDER','ASK_FIBER'].includes(intent)) { ready = true; }
  return { intent, entities: e, missing, segment, status: ready ? 'ready' : 'needs_review', source: 'ai' };
}

// Replace UNKNOWN_INTENT actions with AI proposals (in order). AI errors never
// fail interpret — the deterministic result stands.
async function aiFillUnknown(actions, ctx, userId) {
  const unknownIdx = actions.map((a, i) => (a.intent === 'UNKNOWN_INTENT' ? i : -1)).filter(i => i >= 0);
  if (!unknownIdx.length || !aiEnabled()) return;
  try {
    const segs = unknownIdx.map(i => actions[i].segment);
    const out = await askJSON('voice_intents', INTENT_SCHEMA, INTENT_INSTRUCTIONS,
      segs.map((s, i) => `${i + 1}. ${s}`).join('\n'), undefined, userId, { maxOutputTokens: 1200 });
    (out?.actions || []).slice(0, unknownIdx.length).forEach((raw, i) => {
      if (raw && typeof raw === 'object') actions[unknownIdx[i]] = aiAction(raw, actions[unknownIdx[i]].segment, ctx);
    });
  } catch { /* keep deterministic result */ }
}

// POST /voice/interpret — transcript → proposed actions (+ server-side
// entity matches for confirmation). context: { lastExercise, lastWeight,
// lastSetId, weightUnit } — never trusted, only used to fill references.
router.post('/interpret', voiceEnabled, wrap(async (req, res) => {
  const { transcript, context } = req.body || {};
  if (typeof transcript !== 'string' || !transcript.trim()) throw httpError(400, 'transcript required');
  const prisma = getPrisma();
  const ctx = context || {};
  const parsed = parseTranscript(transcript, ctx);
  await aiFillUnknown(parsed.actions, ctx, uid(req));
  // Fiber questions get a deterministic answer at execute time — flag-gated;
  // the same engine code that answers chat answers voice.
  const fiberVoice = await flags.isEnabled('fiber_voice_enabled', uid(req)).catch(() => false);
  const { isFiberQuestion } = require('../services/fiber/assistant');
  for (const a of parsed.actions) {
    const seg = String(a.segment || '');
    // Interrogative fiber phrasing is a question, never a log — the rule
    // parser maps "how much fiber have I had" to LOG_FOOD, so remap any
    // question-shaped segment, not just UNKNOWN_INTENT.
    const interrogative = /[?]\s*$|^\s*(how|what|why|which|can|could|should|do|does|is|are|am|will|tell me|show me)\b/i.test(seg);
    if (fiberVoice && isFiberQuestion(seg) && (a.intent === 'UNKNOWN_INTENT' || (a.intent === 'LOG_FOOD' && interrogative))) {
      a.intent = 'ASK_FIBER'; a.status = 'ready'; a.missing = [];
      continue;
    }
  }
  for (const a of parsed.actions) {
    if (a.intent === 'LOG_EXERCISE_SET' && a.entities.exerciseName) {
      a.matches = await resolveExercise(prisma, a.entities.exerciseName);
      if (a.matches.length !== 1) a.status = 'needs_review';
      if (a.matches.length) a.entities.exerciseId = a.matches[0].id;
    }
    if (a.intent === 'LOG_FOOD') {
      for (const item of a.entities.items) {
        const ing = await resolveIngredient(prisma, item.name);
        item.ingredientId = ing?.id || null;
        item.matchedName = ing?.name || null;
        if (!ing) { item.status = 'needs_review'; a.status = 'needs_review'; continue; }
        if (item.grams == null) {
          // Household units ("2 slices") resolve at interpret time so the
          // proposal shows the same grams the manual flow would compute.
          const srv = await resolveHouseholdServing(prisma, ing.id, item.quantity, item.unit);
          if (srv) { item.grams = Math.round(srv.grams * 100) / 100; item.resolvedServing = srv; item.status = 'ready'; }
          else { item.status = 'needs_review'; a.status = 'needs_review'; }
        }
      }
      if (a.entities.items.length && a.entities.items.every(i => i.status !== 'needs_review')) { a.status = 'ready'; a.missing = (a.missing || []).filter(m => m !== 'grams'); }
    }
    if (a.intent === 'MARK_SUPPLEMENT_TAKEN') {
      const links = await prisma.userSupplement.findMany({
        where: { userId: uid(req), supplement: a.entities.name ? { name: { contains: a.entities.name, mode: 'insensitive' } } : {} },
        include: { supplement: true }, take: 5,
      });
      a.matches = links.map(l => ({ id: l.id, name: l.supplement.name }));
      if (a.matches.length !== 1) a.status = 'needs_review';
    }
  }
  res.json(parsed);
}));

// POST /voice/commands/execute — { commandId, transcript, actions[] }.
// Idempotent on commandId. Executes via existing models only; nothing here
// trusts an ID that wasn't re-verified server-side.
router.post('/commands/execute', wrap(async (req, res) => {
  const userId = uid(req);
  const { commandId, transcript, actions } = req.body || {};
  if (!userId) throw httpError(401, 'Sign in required.');
  if (typeof commandId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(commandId)) throw httpError(400, 'Stable commandId required');
  if (!Array.isArray(actions) || !actions.length) throw httpError(400, 'actions required');

  const prisma = getPrisma();
  const prior = await prisma.voiceCommand.findUnique({ where: { id: commandId } });
  if (prior) {
    if (prior.userId !== userId) throw httpError(409, 'Command id conflict');
    return res.json({ commandId, result: prior.result, createdEntities: prior.createdEntities, deduplicated: true });
  }

  const created = []; const results = [];
  for (const a of actions) {
    if (a.status !== 'ready') { results.push({ intent: a.intent, status: 'skipped', reason: 'needs_review' }); continue; }
    switch (a.intent) {
      case 'LOG_WATER': {
        const ml = Math.round(Number(a.entities.amountMl));
        if (!ml || ml <= 0 || ml > 5000) { results.push({ intent: a.intent, status: 'skipped', reason: 'amount out of range' }); break; }
        const log = await prisma.waterLog.create({ data: { userId, amountMl: ml } });
        created.push({ kind: 'water', id: log.id });
        results.push({ intent: a.intent, status: 'saved', detail: `${ml} ml water logged` });
        break;
      }
      case 'LOG_EXERCISE_SET': {
        const exId = a.entities.exerciseId;
        const ex = exId ? await prisma.exercise.findUnique({ where: { id: String(exId) } }) : null;
        const name = ex ? ex.normalizedName : a.entities.exerciseName;
        const sets = Math.min(10, Math.max(1, Math.round(Number(a.entities.sets) || 1)));
        const reps = Math.round(Number(a.entities.reps));
        if (!name || !Number.isFinite(reps) || reps <= 0 || reps > 500) { results.push({ intent: a.intent, status: 'skipped', reason: 'exercise or reps unresolved' }); break; }
        let weightLbs = null;
        if (a.entities.weight != null) {
          const w = Number(a.entities.weight);
          if (!Number.isFinite(w) || w < 0 || w > 2000) break;
          weightLbs = a.entities.weightUnit === 'kg' ? Math.round(w * 2.2046226 * 10) / 10 : w;
        }
        const now = new Date();
        const session = await prisma.workoutSession.create({ data: {
          userId, workoutType: 'strength', durationMinutes: 0, startedAt: now, endedAt: now, finishedAt: now, source: 'voice',
        } });
        await prisma.exerciseSet.createMany({ data: Array.from({ length: sets }, (_, i) => ({
          workoutSessionId: session.id, exerciseName: name, reps, weightLbs, setNumber: i + 1,
        })) });
        created.push({ kind: 'workoutSession', id: session.id });
        results.push({ intent: a.intent, status: 'saved', detail: `${sets}×${reps}${weightLbs != null ? ` @ ${a.entities.weight} ${a.entities.weightUnit}` : ''} ${name}` });
        break;
      }
      case 'LOG_FOOD': {
        for (const [i, item] of (a.entities.items || []).entries()) {
          const grams = Number(item.grams);
          const ing = item.ingredientId ? await prisma.ingredient.findUnique({ where: { id: String(item.ingredientId) } }) : await resolveIngredient(prisma, item.name);
          if (!ing) { results.push({ intent: a.intent, status: 'skipped', reason: `${item.name}: no catalog match` }); continue; }
          // Household units resolve against the ingredient's catalog servings so
          // "2 slices" logs the same way as the manual flow (server-side
          // serving→gram conversion); grams-only items keep the weight path.
          let n = null; let gramsUsed = Number.isFinite(grams) && grams > 0 ? grams : null; let servingMeta = null;
          // Interpret echoes resolvedServing when a household unit matched a
          // catalog serving; prefer it so the persisted snapshot keeps the
          // serving identity for reopen. calculate() re-validates that the
          // servingId belongs to this ingredient — a stale/forged id throws.
          const echoed = item.resolvedServing;
          if (echoed && typeof echoed.servingId === 'string' && Number.isFinite(Number(echoed.count)) && Number(echoed.count) > 0) {
            try { n = await ingredientNutrition.calculate(ing.id, { servingId: String(echoed.servingId).slice(0, 80), count: Number(echoed.count) }); }
            catch { n = null; }
            if (n && n.serving) {
              gramsUsed = n.grams;
              servingMeta = { servingId: n.serving.id, selectedServing: n.serving.label, servingGrams: n.serving.grams, servingCount: n.serving.count };
            }
          }
          if (!n && !gramsUsed) {
            const srv = await resolveHouseholdServing(prisma, ing.id, item.quantity, item.unit);
            if (srv) {
              try { n = await ingredientNutrition.calculate(ing.id, { servingId: srv.servingId, count: srv.count }); }
              catch { n = null; }
              if (n) {
                gramsUsed = n.grams;
                servingMeta = { servingId: srv.servingId, selectedServing: srv.label, servingGrams: srv.grams, servingCount: srv.count };
              }
            }
          }
          if (!n && gramsUsed) n = await ingredientNutrition.calculate(ing.id, { grams: gramsUsed });
          if (!n || !Number.isFinite(gramsUsed) || gramsUsed <= 0 || gramsUsed > 10000) {
            results.push({ intent: a.intent, status: 'skipped', reason: `${item.name}: needs a gram amount or a recognized serving` }); continue;
          }
          const saved = await prisma.foodLog.create({ data: {
            id: `voice-${commandId}-${i}`, userId, foodName: item.name.slice(0, 300),
            quantityG: gramsUsed, calories: n.nutrition.calories ?? 0, proteinG: n.nutrition.proteinG ?? 0,
            carbsG: n.nutrition.carbsG ?? 0, fatG: n.nutrition.fatG ?? 0, fiberG: n.nutrition.fiberG ?? null,
            mealType: String(a.entities.mealType || 'meal').slice(0, 30), ingredientId: ing.id,
            nutritionSnapshot: { loggedSource: 'voice', grams: gramsUsed, calculated: n.nutrition, nutrientUnknowns: require('../services/nutrientCompleteness').computeUnknowns(n.nutrition), ...(servingMeta || {}) },
          } });
          created.push({ kind: 'foodLog', id: saved.id });
          results.push({ intent: a.intent, status: 'saved', detail: `${gramsUsed}g ${ing.name} → ${a.entities.mealType || 'meal'}` });
        }
        break;
      }
      case 'MARK_SUPPLEMENT_TAKEN': {
        const link = await prisma.userSupplement.findFirst({
          where: { userId, supplement: { name: { contains: String(a.entities.name || ''), mode: 'insensitive' } } },
          include: { supplement: true },
        });
        if (!link) { results.push({ intent: a.intent, status: 'skipped', reason: 'supplement not found in your list' }); break; }
        const sup = link.supplement; const today = new Date().toISOString().slice(0, 10);
        const log = await prisma.supplementLog.create({ data: {
          userId, userSupplementId: link.id, supplementName: sup.name, quantity: 1,
          calories: sup.calories || 0, proteinG: sup.proteinG || 0, carbsG: sup.carbsG || 0,
          fatG: sup.fatG || 0, fiberG: sup.fiberG || 0, date: today,
        } });
        created.push({ kind: 'supplementLog', id: log.id });
        results.push({ intent: a.intent, status: 'saved', detail: `${sup.name} marked taken` });
        break;
      }
      case 'UPDATE_EXERCISE_SET': {
        const reps = Math.round(Number(a.entities.reps));
        if (!Number.isFinite(reps) || reps <= 0 || reps > 500) { results.push({ intent: a.intent, status: 'skipped', reason: 'reps unresolved' }); break; }
        // Client-supplied setId is re-verified against ownership; otherwise
        // resolve to the most recent set in the user's latest session.
        let set = null;
        if (a.entities.setId) {
          set = await prisma.exerciseSet.findFirst({ where: { id: String(a.entities.setId), workoutSession: { userId } } });
        } else {
          const latest = await prisma.workoutSession.findFirst({
            where: { userId }, orderBy: { startedAt: 'desc' },
            include: { exerciseSets: { orderBy: { setNumber: 'desc' }, take: 1 } },
          });
          set = latest?.exerciseSets[0] || null;
        }
        if (!set) { results.push({ intent: a.intent, status: 'skipped', reason: 'no set to update' }); break; }
        await prisma.exerciseSet.update({ where: { id: set.id }, data: { reps } });
        created.push({ kind: 'exerciseSetUpdate', id: set.id, prev: { reps: set.reps } });
        results.push({ intent: a.intent, status: 'saved', detail: `${set.exerciseName} set → ${reps} reps` });
        break;
      }
      case 'LOG_MOOD': {
        const mindOn = await flags.isEnabled('mind_habits_enabled', userId).catch(() => false);
        if (!mindOn) { results.push({ intent: a.intent, status: 'skipped', reason: 'Mind & Habits is off for this account' }); break; }
        const en = Math.min(5, Math.max(1, Math.round(a.entities.energy ?? 3)));
        const st = Math.min(5, Math.max(1, Math.round(a.entities.stress ?? 3)));
        const c = await prisma.emotionalCheckIn.create({ data: {
          userId, mood: a.entities.mood, energy: en, stress: st,
        } });
        created.push({ kind: 'emotionalCheckIn', id: c.id });
        results.push({ intent: a.intent, status: 'saved', detail: `mood logged as ${a.entities.mood.replace('_',' ')}` });
        break;
      }
      case 'REPORT_INJURY': {
        // Voice-captured injury report — feeds the shared safety context so
        // every suggestion respects it from the next evaluation on.
        const bodyPart = String(a.entities.bodyPart || a.entities.affectedPart || '').toLowerCase().trim();
        if (!bodyPart || bodyPart.length > 40) { results.push({ intent: a.intent, status: 'skipped', reason: 'affected body part unresolved' }); break; }
        const laterality = ['left', 'right', 'bilateral', 'na'].includes(a.entities.laterality) ? a.entities.laterality
          : (/right/i.test(transcript || '') ? 'right' : /left/i.test(transcript || '') ? 'left' : 'na');
        const pain = Number(a.entities.painLevel);
        const inj = await prisma.userInjury.create({ data: {
          userId,
          type: String(a.entities.type || 'unspecified').slice(0, 60),
          bodyPart, laterality,
          status: 'current',
          painLevel: Number.isFinite(pain) ? Math.min(10, Math.max(0, Math.round(pain))) : null,
          weightBearingRestriction: a.entities.weightBearingRestriction || null,
          prohibitedCategories: Array.isArray(a.entities.prohibitedCategories) ? a.entities.prohibitedCategories : [],
          source: 'voice',
          injuredAt: new Date(),
          rehabInstructions: a.entities.notes ? String(a.entities.notes).slice(0, 1000) : null,
        } });
        created.push({ kind: 'userInjury', id: inj.id });
        const followUps = [];
        if (inj.weightBearingRestriction == null) {
          followUps.push('Did a clinician give you weight-bearing instructions (e.g., non-weight-bearing)?');
        }
        if (!a.entities.type) followUps.push('What kind of injury is it, if you know?');
        results.push({ intent: a.intent, status: 'saved',
          detail: `Recorded ${laterality !== 'na' ? `${laterality} ` : ''}${bodyPart} injury — activity suggestions now account for it.`,
          safety: { injuryId: inj.id, followUps, notPermanent: true, noDiagnosis: true } });
        break;
      }
      case 'REPORT_SYMPTOM': {
        const codes = (Array.isArray(a.entities.symptoms) ? a.entities.symptoms : [a.entities.symptom])
          .map(s => String(s || '').toLowerCase().trim()).filter(Boolean);
        if (!codes.length) { results.push({ intent: a.intent, status: 'skipped', reason: 'symptom unresolved' }); break; }
        const urgent = codes.filter(c => SYMPTOMS_URGENT.has(c));
        const report = await prisma.userSymptomReport.create({ data: {
          userId, symptoms: codes, source: 'voice',
          severity: ['mild', 'moderate', 'severe'].includes(a.entities.severity) ? a.entities.severity : null,
          context: 'unspecified', status: 'active',
          triageOutcome: urgent.length ? 'urgent_escalation' : 'recorded',
        } });
        created.push({ kind: 'symptomReport', id: report.id });
        results.push({ intent: a.intent, status: 'saved',
          detail: urgent.length
            ? 'Do not begin a workout. Your reported symptoms may require urgent medical attention — contact local emergency services or seek urgent care now.'
            : 'Symptom recorded — activity suggestions will account for it.',
          safety: { urgent: urgent.length > 0, urgentSymptoms: urgent, suppressesActivitySuggestions: true, noDiagnosis: true } });
        break;
      }
      case 'START_BREATHING_EXERCISE': {
        const mindOn = await flags.isEnabled('mind_habits_enabled', userId).catch(() => false);
        results.push({ intent: a.intent, status: mindOn ? 'saved' : 'skipped', reason: mindOn ? undefined : 'Mind & Habits is off', detail: 'breathing-2min', navigate: 'MindExercise', params: { exerciseKey: 'breathing-2min' } });
        break;
      }
      case 'SHOW_MOOD_TRENDS': {
        const mindOn = await flags.isEnabled('mind_habits_enabled', userId).catch(() => false);
        results.push({ intent: a.intent, status: mindOn ? 'saved' : 'skipped', reason: mindOn ? undefined : 'Mind & Habits is off', detail: 'insights', navigate: 'MindHome' });
        break;
      }
      case 'CREATE_REFLECTION_REMINDER': {
        const mindOn = await flags.isEnabled('mind_habits_enabled', userId).catch(() => false);
        if (!mindOn) { results.push({ intent: a.intent, status: 'skipped', reason: 'Mind & Habits is off' }); break; }
        await prisma.userMindPreferences.upsert({ where: { userId }, create: { userId, remindersEnabled: true }, update: { remindersEnabled: true } });
        results.push({ intent: a.intent, status: 'saved', detail: 'reflection reminders enabled (optional daily check-in)' });
        break;
      }
      case 'START_WORKOUT': {
        const session = await prisma.workoutSession.create({ data: {
          userId, workoutType: String(a.entities.name || 'voice').slice(0, 50),
          startedAt: new Date(), endedAt: new Date(), durationMinutes: 0, source: 'voice',
        } });
        created.push({ kind: 'workoutSession', id: session.id });
        // Safety pre-check (flag-gated): voice can't bypass the engine. Starting
        // a workout is the user's action — the engine annotates, never hijacks.
        let safetyNote;
        try {
          if (await flags.isEnabled('activity_safety_engine', userId).catch(() => false)) {
            const ctx = await safety.loadSafetyContext(prisma, userId);
            const act = safety.getActivity(workoutActivityId(a.entities.name));
            const r = safety.evaluate(ctx, act, null, { rules: await safety.loadRules(prisma) });
            if (safety.DECISION_RANK[r.decision] >= safety.DECISION_RANK.INSUFFICIENT_DATA) {
              safetyNote = { decision: r.decision, reasons: r.reasons.slice(0, 2) };
            }
          }
        } catch { /* pre-check failure never blocks the user's own action */ }
        results.push({ intent: a.intent, status: 'saved', detail: `${a.entities.name || 'Workout'} started`, ...(safetyNote ? { safetyNote } : {}) });
        break;
      }
      case 'COMPLETE_WORKOUT': {
        const s = await prisma.workoutSession.findFirst({ where: { userId, finishedAt: null }, orderBy: { startedAt: 'desc' } });
        if (!s) { results.push({ intent: a.intent, status: 'skipped', reason: 'no open workout' }); break; }
        const now = new Date();
        await prisma.workoutSession.update({ where: { id: s.id }, data: {
          finishedAt: now, endedAt: now, durationMinutes: Math.max(0, Math.round((now - s.startedAt) / 60000)),
        } });
        created.push({ kind: 'workoutSessionComplete', id: s.id, prev: { finishedAt: s.finishedAt, endedAt: s.endedAt, durationMinutes: s.durationMinutes } });
        results.push({ intent: a.intent, status: 'saved', detail: 'Workout finished' });
        break;
      }
      case 'UNDO_ACTION': {
        const last = await prisma.voiceCommand.findFirst({
          where: { userId, undoneAt: null, id: { not: commandId } }, orderBy: { createdAt: 'desc' },
        });
        if (!last) { results.push({ intent: a.intent, status: 'skipped', reason: 'nothing to undo' }); break; }
        if (Date.now() - last.createdAt.getTime() > UNDO_WINDOW_MS) {
          results.push({ intent: a.intent, status: 'skipped', reason: 'undo window expired' }); break;
        }
        await applyUndo(prisma, last);
        await prisma.voiceCommand.update({ where: { id: last.id }, data: { undoneAt: new Date() } });
        results.push({ intent: a.intent, status: 'saved', detail: 'Last action undone' });
        break;
      }
      case 'ASK_FIBER': {
        // Deterministic fiber answer — same engine as chat. Flag re-checked
        // server-side at execution; answers create no entities and need no undo.
        const on = await flags.isEnabled('fiber_voice_enabled', userId).catch(() => false);
        if (!on) { results.push({ intent: a.intent, status: 'skipped', reason: 'fiber voice answers are off for this account' }); break; }
        const grounded = await require('../services/fiber/assistant').groundFiberAnswer(userId, String(a.segment || transcript || '')).catch(() => ({ handled: false }));
        if (!grounded.handled) { results.push({ intent: a.intent, status: 'skipped', reason: 'could not answer from fiber data' }); break; }
        results.push({ intent: a.intent, status: 'answered', detail: grounded.answer });
        break;
      }
      case 'CANCEL_COMMAND':
        results.push({ intent: a.intent, status: 'acknowledged', detail: 'Handled in the app.' });
        break;
      default:
        results.push({ intent: a.intent, status: 'skipped', reason: 'unsupported intent' });
    }
  }

  const record = await prisma.voiceCommand.create({ data: {
    id: commandId, userId, transcript: String(transcript || '').slice(0, 1000),
    actions, createdEntities: created, result: results,
  } });
  res.status(201).json({ commandId, result: record.result, createdEntities: record.createdEntities });
}));

// POST /voice/commands/undo — reverse a command's writes within 15 minutes.
router.post('/commands/undo', wrap(async (req, res) => {
  const userId = uid(req);
  const { commandId } = req.body || {};
  const prisma = getPrisma();
  const cmd = await prisma.voiceCommand.findUnique({ where: { id: String(commandId || '') } });
  if (!cmd || cmd.userId !== userId) throw httpError(404, 'Nothing to undo');
  if (cmd.undoneAt) return res.json({ undone: true, already: true });
  if (Date.now() - cmd.createdAt.getTime() > UNDO_WINDOW_MS) throw httpError(422, 'Undo window expired (15 minutes)');
  await applyUndo(prisma, cmd);
  await prisma.voiceCommand.update({ where: { id: cmd.id }, data: { undoneAt: new Date() } });
  res.json({ undone: true });
}));

module.exports = router;

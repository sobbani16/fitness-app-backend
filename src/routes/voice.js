const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { parseTranscript } = require('../services/voice/voiceParser');
const { aiEnabled, askJSON } = require('../services/aiProvider');
const ingredientNutrition = require('../services/ingredientNutrition');
const httpError = require('../lib/errors').httpError;

const router = express.Router();
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

// Reverses one command's writes. createdEntities entries may carry `prev`
// state for in-place updates so undo restores rather than deletes.
const applyUndo = async (prisma, cmd) => {
  for (const e of cmd.createdEntities) {
    if (e.kind === 'water') await prisma.waterLog.deleteMany({ where: { id: e.id, userId: cmd.userId } });
    if (e.kind === 'foodLog') await prisma.foodLog.deleteMany({ where: { id: e.id, userId: cmd.userId } });
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
  }
};

// POST /voice/transcribe — audio → text. Returns 503 until a provider is
// configured; body: { audio: base64, format }. Audio is never persisted.
router.post('/transcribe', wrap(async (req, res) => {
  const { audio } = req.body || {};
  if (typeof audio !== 'string' || !audio.length) throw httpError(400, 'audio (base64) required');
  if (audio.length > 4_000_000) throw httpError(413, 'Audio too large — keep clips under ~30 seconds.');
  if (!aiEnabled()) throw httpError(503, 'Voice transcription is not configured.');
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
  'UPDATE_EXERCISE_SET', 'START_WORKOUT', 'COMPLETE_WORKOUT', 'UNDO_ACTION', 'CANCEL_COMMAND', 'UNKNOWN_INTENT'];

const NULLABLE = { type: ['number', 'null'] };
const NULLABLE_STR = { type: ['string', 'null'] };
const INTENT_SCHEMA = {
  actions: {
    type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        intent: { type: 'string', enum: VOICE_INTENTS }, segment: { type: 'string' },
        exerciseName: NULLABLE_STR, sets: NULLABLE, reps: NULLABLE, weight: NULLABLE, weightUnit: NULLABLE_STR,
        amountMl: NULLABLE, mealType: NULLABLE_STR, name: NULLABLE_STR,
        items: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { name: { type: 'string' }, grams: NULLABLE, quantity: NULLABLE, unit: NULLABLE_STR },
            required: ['name', 'grams', 'quantity', 'unit'],
          },
        },
      },
      required: ['intent', 'segment', 'exerciseName', 'sets', 'reps', 'weight', 'weightUnit', 'amountMl', 'mealType', 'name', 'items'],
    },
  },
};
const INTENT_INSTRUCTIONS = `You convert short voice commands from a fitness logging app into structured actions, one action per numbered input segment.
Intents: LOG_EXERCISE_SET (add sets/reps/weight of an exercise), LOG_FOOD (food items; split every distinct food), LOG_WATER (water amount), MARK_SUPPLEMENT_TAKEN, UPDATE_EXERCISE_SET (change the most recent set), START_WORKOUT, COMPLETE_WORKOUT, UNDO_ACTION, CANCEL_COMMAND, UNKNOWN_INTENT (not a logging command).
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
    items: Array.isArray(raw.items) ? raw.items.filter(i => i && typeof i.name === 'string' && i.name.trim())
      .map(i => ({ name: i.name.trim(), grams: numOrNull(i.grams), quantity: numOrNull(i.quantity), unit: typeof i.unit === 'string' ? i.unit : 'servings' })) : [],
  };
  let missing = []; let ready = true;
  if (intent === 'LOG_EXERCISE_SET') {
    missing = [e.exerciseName ? null : 'exercise', e.reps ? null : 'reps'].filter(Boolean);
    ready = Boolean(e.exerciseName && e.reps);
  } else if (intent === 'LOG_WATER') { missing = e.amountMl ? [] : ['amountMl']; ready = Boolean(e.amountMl); }
  else if (intent === 'LOG_FOOD') { missing = e.items.length ? (e.items.some(i => i.grams == null) ? ['grams'] : []) : ['items']; ready = e.items.length > 0 && e.items.every(i => i.grams != null); }
  else if (intent === 'MARK_SUPPLEMENT_TAKEN') { missing = e.name ? [] : ['name']; ready = Boolean(e.name); }
  else if (intent === 'UPDATE_EXERCISE_SET') { missing = [e.reps ? null : 'reps', ctx.lastSetId ? null : 'set'].filter(Boolean); ready = Boolean(e.reps && ctx.lastSetId); }
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
router.post('/interpret', wrap(async (req, res) => {
  const { transcript, context } = req.body || {};
  if (typeof transcript !== 'string' || !transcript.trim()) throw httpError(400, 'transcript required');
  const prisma = getPrisma();
  const ctx = context || {};
  const parsed = parseTranscript(transcript, ctx);
  await aiFillUnknown(parsed.actions, ctx, uid(req));
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
        if (!ing || item.grams == null) { item.status = 'needs_review'; a.status = 'needs_review'; }
      }
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
          if (!ing || !Number.isFinite(grams) || grams <= 0 || grams > 10000) {
            results.push({ intent: a.intent, status: 'skipped', reason: `${item.name}: needs a gram amount and a catalog match` }); continue;
          }
          const n = await ingredientNutrition.calculate(ing.id, { grams });
          const saved = await prisma.foodLog.create({ data: {
            id: `voice-${commandId}-${i}`, userId, foodName: item.name.slice(0, 300),
            quantityG: grams, calories: n.nutrition.calories ?? 0, proteinG: n.nutrition.proteinG ?? 0,
            carbsG: n.nutrition.carbsG ?? 0, fatG: n.nutrition.fatG ?? 0, fiberG: n.nutrition.fiberG ?? null,
            mealType: String(a.entities.mealType || 'meal').slice(0, 30), ingredientId: ing.id,
            nutritionSnapshot: { loggedSource: 'voice', grams, calculated: n.nutrition },
          } });
          created.push({ kind: 'foodLog', id: saved.id });
          results.push({ intent: a.intent, status: 'saved', detail: `${grams}g ${ing.name} → ${a.entities.mealType || 'meal'}` });
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
      case 'START_WORKOUT': {
        const session = await prisma.workoutSession.create({ data: {
          userId, workoutType: String(a.entities.name || 'voice').slice(0, 50),
          startedAt: new Date(), endedAt: new Date(), durationMinutes: 0, source: 'voice',
        } });
        created.push({ kind: 'workoutSession', id: session.id });
        results.push({ intent: a.intent, status: 'saved', detail: `${a.entities.name || 'Workout'} started` });
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

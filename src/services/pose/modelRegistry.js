// pc-HUM-110 sections 20+32: versioned model registry + controlled rollout.
// Invariants:
//  - nothing is ever auto-promoted: registered -> candidate -> approved -> active
//    requires explicit independent-evaluation evidence (approvalRef) at each step
//  - activation requires approvalRef AND evalResults — no exceptions
//  - rollback never deletes history: events append to MlRolloutEvent
//  - per-exercise capability disabling overrides without touching the artifact
//  - baseline-vs-ML comparison is mandatory before an ML (non-baseline)
//    architecture may reach 'approved'
const { httpError } = require('../../lib/errors');

const TRANSITIONS = {
  registered: ['candidate', 'retired'],
  candidate: ['approved', 'registered', 'retired'],
  approved: ['active', 'retired'],
  active: ['rolled_back'],
  rolled_back: ['active', 'retired'],
  retired: [],
};

const ML_ARCHITECTURES = new Set(['tcn', 'lstm_gru', 'hybrid']);

function assertTransition(from, to) {
  if (!(TRANSITIONS[from] || []).includes(to)) {
    throw httpError(409, `illegal registry transition ${from} → ${to}`);
  }
}

function validateRegistration(data) {
  const required = ['name', 'version', 'architecture', 'datasetVersion', 'configHash', 'seed', 'supportedExercises', 'capabilities', 'checksum', 'runtimeCompat'];
  for (const k of required) if (data[k] == null) throw httpError(400, `missing registry field: ${k}`);
  if (!['deterministic_baseline', 'tcn', 'lstm_gru', 'hybrid'].includes(data.architecture)) throw httpError(400, `unknown architecture: ${data.architecture}`);
  if (!Array.isArray(data.supportedExercises) || !data.supportedExercises.length) throw httpError(400, 'supportedExercises must be a non-empty array');
  if (typeof data.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(data.checksum)) throw httpError(400, 'checksum must be a sha256 hex digest');
  if (typeof data.capabilities !== 'object' || data.capabilities === null || Array.isArray(data.capabilities)) throw httpError(400, 'capabilities must be an object keyed by exercise');
  for (const ex of data.supportedExercises) {
    const cap = data.capabilities[ex];
    if (!cap || !Array.isArray(cap.observations)) throw httpError(400, `capabilities.${ex} must declare observations[]`);
  }
}

async function registerModel(prisma, data) {
  validateRegistration(data);
  return prisma.mlModel.create({ data: { ...data, status: 'registered' } });
}

async function transition(prisma, modelId, to, { actor = 'system', reason = '', baselineComparison = null } = {}) {
  const model = await prisma.mlModel.findUnique({ where: { id: modelId } });
  if (!model) throw httpError(404, 'model_not_found');
  assertTransition(model.status, to);
  if (!reason.trim()) throw httpError(400, 'transitions require a reason');

  if (to === 'approved' && ML_ARCHITECTURES.has(model.architecture)) {
    // Baseline-vs-ML comparison is mandatory for non-baseline architectures.
    const cmp = baselineComparison || model.evalResults?.baselineComparison;
    if (!cmp || typeof cmp !== 'object' || cmp.beatsBaseline !== true) {
      throw httpError(409, 'ML architectures may not be approved without an independent baseline comparison showing beatsBaseline=true');
    }
  }
  if (to === 'active') {
    if (!model.approvalRef) throw httpError(409, 'activation requires an approvalRef (independent evaluation evidence)');
    if (!model.evalResults) throw httpError(409, 'activation requires evalResults — no activation on unmeasured models');
    // Only one active model per name at a time.
    const active = await prisma.mlModel.findFirst({ where: { name: model.name, status: 'active', id: { not: model.id } } });
    if (active) {
      await prisma.mlRolloutEvent.create({ data: { modelId: active.id, fromState: 'active', toState: 'rolled_back', reason: `superseded by ${model.id} activation`, actor } });
      // The superseded model's own rollback chain is preserved untouched —
      // rollback targets point BACKWARD from the new model, never self-point.
      await prisma.mlModel.update({ where: { id: active.id }, data: { status: 'rolled_back' } });
      // Controlled-rollout invariant: a promotion must never strand the fleet
      // without a rollback path. If the operator did not wire one explicitly,
      // the superseded active model becomes the rollback target automatically.
      if (!model.rollbackTargetId) {
        await prisma.mlModel.update({ where: { id: model.id }, data: { rollbackTargetId: active.id } });
        model.rollbackTargetId = active.id;
      }
    }
  }

  const event = await prisma.mlRolloutEvent.create({ data: { modelId: model.id, fromState: model.status, toState: to, reason, actor } });
  const updated = await prisma.mlModel.update({
    where: { id: model.id },
    data: { status: to, rollbackTargetId: model.rollbackTargetId || undefined, ...(to === 'active' ? { promotedAt: new Date() } : {}) },
  });
  return { model: updated, event };
}

/**
 * Roll back the active model for a name to its rollback target (or just
 * deactivate). History is append-only — nothing is deleted.
 */
async function rollback(prisma, modelId, { actor = 'system', reason = '' } = {}) {
  const model = await prisma.mlModel.findUnique({ where: { id: modelId } });
  if (!model) throw httpError(404, 'model_not_found');
  if (model.status !== 'active') throw httpError(409, 'only an active model can be rolled back');
  const out = await transition(prisma, modelId, 'rolled_back', { actor, reason: reason || 'manual rollback' });
  if (model.rollbackTargetId) {
    const target = await prisma.mlModel.findUnique({ where: { id: model.rollbackTargetId } });
    if (target && target.status === 'rolled_back') {
      await transition(prisma, target.id, 'active', { actor, reason: `rollback restoration of ${target.version}` });
    }
  }
  return out;
}

/**
 * Per-exercise capability disable — overrides capabilities[exercise].enabled
 * without mutating the artifact checksum. Reversible by design.
 */
async function setExerciseEnabled(prisma, modelId, exercise, enabled, { actor = 'system' } = {}) {
  const model = await prisma.mlModel.findUnique({ where: { id: modelId } });
  if (!model) throw httpError(404, 'model_not_found');
  if (!model.supportedExercises.includes(exercise)) throw httpError(400, `${exercise} is not supported by this model`);
  const capabilities = { ...model.capabilities, [exercise]: { ...model.capabilities[exercise], enabled: !!enabled } };
  await prisma.mlRolloutEvent.create({ data: { modelId, fromState: model.status, toState: model.status, reason: `capability ${exercise} → ${enabled ? 'enabled' : 'disabled'}`, actor } });
  return prisma.mlModel.update({ where: { id: modelId }, data: { capabilities } });
}

/** What the runtime may load: active models with per-exercise overrides applied. */
async function activeManifest(prisma) {
  const active = await prisma.mlModel.findMany({ where: { status: 'active' } });
  return active.map((m) => ({
    name: m.name, version: m.version, architecture: m.architecture, checksum: m.checksum,
    runtimeCompat: m.runtimeCompat,
    exercises: Object.fromEntries(
      m.supportedExercises.map((ex) => [ex, { enabled: m.capabilities[ex]?.enabled !== false, observations: m.capabilities[ex]?.observations || [] }])
    ),
  }));
}

module.exports = { registerModel, transition, rollback, setExerciseEnabled, activeManifest, TRANSITIONS };

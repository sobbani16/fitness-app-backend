// Deterministic, versioned exercise suitability rules.
// Classification: 'suitable' | 'adapt' | 'needs-info' | 'review'.
// No medical claims: 'review' flags cases needing qualified human input —
// it never declares an exercise unsafe OR safe for a condition.
const RULE_VERSION = 'suitability.v1';
const { EXERCISES } = require('./exerciseCatalog');

// limitations: free-text/flag set, e.g. ['wrist-pain','low-back','balance','shoulder','seated-only','knee']
const LIMITATION_BLOCKS = {
  'seated-only': (e) => e.position !== 'seated' && e.position !== 'lying',
  'wrist-pain':  (e) => e.mobility === 'wrist-extension',
  'shoulder':    (e) => e.mobility === 'shoulder-flexion' || e.mobility === 'shoulder-extension',
  'balance':     (e) => e.balance === 'high',
  'hip':         (e) => e.mobility === 'hip-hinge' || e.mobility === 'ankle-hip',
  'knee':        (e) => e.pattern === 'single-leg' || e.pattern === 'squat',
  'floor':       (e) => e.position === 'floor' || e.equipment.includes('floor'),
};

// Limitations that adapt rather than exclude (swap to lower-impact variant).
const ADAPT_SOFT = ['knee', 'balance'];

/**
 * classify(exerciseId, profile) -> { status, reasons[], alternatives[] }
 * profile: { experience, equipment[], location, limitations[], age? }
 */
function classify(exerciseId, profile = {}) {
  const e = EXERCISES[exerciseId];
  if (!e) return { status: 'review', reasons: ['Unknown exercise — not in catalog'], alternatives: [] };
  const reasons = [];
  const limitations = profile.limitations || [];

  // Hard review cases — substantial functional limits get qualified review,
  // not an automatic "safe" prescription.
  for (const lim of limitations) {
    if (lim === 'recent-injury' || lim === 'rehab' || lim === 'medical-restriction') {
      return { status: 'review', reasons: [`${e.name}: you reported ${lim.replace('-', ' ')} — needs reviewed guidance before inclusion`], alternatives: e.alternatives };
    }
  }
  for (const lim of limitations) {
    const blocks = LIMITATION_BLOCKS[lim];
    if (blocks?.(e)) {
      if (ADAPT_SOFT.includes(lim) && e.alternatives.length) {
        reasons.push(`${e.name}: consider a lower-demand alternative for reported ${lim.replace('-', ' ')}`);
        return { status: 'adapt', reasons, alternatives: e.alternatives };
      }
      return { status: 'adapt', reasons: [`${e.name}: may not suit reported ${lim.replace('-', ' ')}`], alternatives: e.alternatives };
    }
  }

  // Equipment feasibility — needs-info only when equipment unknown; adapt when known-missing.
  const needed = e.equipment.filter(x => x !== 'bodyweight' && x !== 'floor');
  if (needed.length) {
    const have = profile.equipment;
    if (!have) reasons.push('Equipment availability not provided — verify you have access');
    else if (!needed.every(n => have.includes(n))) {
      return { status: 'adapt', reasons: [`${e.name}: requires ${needed.join('/')} — not in your equipment list`], alternatives: e.alternatives };
    }
  }

  // Experience gating — advanced moves adapt for beginners, never blocked.
  if (e.difficulty === 'advanced' && profile.experience === 'beginner') {
    return { status: 'adapt', reasons: [`${e.name}: advanced movement — a simpler variation is safer to start`], alternatives: e.alternatives };
  }
  if (needed.length && !profile.equipment) return { status: 'needs-info', reasons: [...reasons, `${e.name}: confirm equipment access`], alternatives: e.alternatives };
  return { status: 'suitable', reasons: reasons.length ? reasons : [`${e.name}: fits your goal, equipment and experience`], alternatives: e.alternatives };
}

/** Evaluate a set of exercises; returns per-id classification. */
function evaluateAll(ids, profile) {
  const out = {};
  for (const id of ids) out[id] = classify(id, profile);
  return out;
}

module.exports = { classify, evaluateAll, RULE_VERSION };

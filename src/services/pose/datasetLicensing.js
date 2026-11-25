// P2 licensing gate — every dataset ingest must pass through here.
// A dataset may only enter the training pipeline when the registry verdict
// is 'approved' or 'approved_with_conditions'; restricted entries need an
// explicit counsel review flag flips; prohibited entries are hard-blocked.
const registry = require('../../../pose/datasets/licensing-registry.json');

function lookup(datasetId) {
  return registry.datasets.find((d) => d.id === datasetId) || null;
}

/**
 * Gate an ingest attempt.
 * @returns {{allowed: boolean, reason: string, verdict: string|null}}
 */
function gateIngest(datasetId, { purpose = 'training' } = {}) {
  const d = lookup(datasetId);
  if (!d) return { allowed: false, reason: `dataset '${datasetId}' is not in the licensing registry — default PROHIBITED`, verdict: null };
  if (d.commercialTraining === 'prohibited') return { allowed: false, reason: `${d.id}: ${d.verdictBasis}`, verdict: 'prohibited' };
  if (d.commercialTraining === 'restricted') {
    if (d.requiresLicenseTextReview) return { allowed: false, reason: `${d.id}: restricted — license text review outstanding (${d.verdictBasis})`, verdict: 'restricted' };
    return { allowed: false, reason: `${d.id}: restricted — isolation required, no training ingest`, verdict: 'restricted' };
  }
  if (d.commercialTraining === 'approved_with_conditions') {
    if (d.notSuitableFor.includes(purpose) || d.notSuitableFor.includes(`${purpose}_metrics`)) {
      return { allowed: false, reason: `${d.id}: approved with conditions — '${purpose}' is excluded (${d.verdictBasis})`, verdict: 'approved_with_conditions' };
    }
    return { allowed: true, reason: `${d.id}: approved with conditions — purpose '${purpose}' within scope`, verdict: 'approved_with_conditions' };
  }
  if (!d.suitableFor.includes(purpose) && purpose !== 'training') {
    return { allowed: false, reason: `${d.id}: approved, but purpose '${purpose}' is not in suitableFor [${d.suitableFor.join(', ')}]`, verdict: 'approved' };
  }
  return { allowed: true, reason: `${d.id}: approved`, verdict: 'approved' };
}

module.exports = { registry, lookup, gateIngest };

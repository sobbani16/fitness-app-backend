'use strict';
// OPS-REQ-4 staging-only: per-synthetic-user environment fixtures for the
// safety eval suite. In-memory on purpose — a deploy/restart wipes all fixture
// env state, so nothing unsafe can persist. Only the SAFETY_STATE_FIXTURE-
// guarded /test-fixtures route writes here; envFor reads it only for
// synthetic-domain users in non-production.
const envByUser = new Map();

function set(userId, env) {
  if (!userId || !env || typeof env !== 'object') return;
  envByUser.set(userId, {
    ...env,
    provider: 'safety_env_fixture',
    observedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  });
}

function get(userId) {
  return envByUser.get(userId) || null;
}

function clear(userId) {
  envByUser.delete(userId);
}

module.exports = { set, get, clear };

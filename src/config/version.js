const pkg = require('../../package.json');

// Bump API_CONTRACT_VERSION when a response shape changes incompatibly.
// MIN_CLIENT_CONTRACT is the oldest mobile contract this server still serves.
const API_CONTRACT_VERSION = 2;
const MIN_CLIENT_CONTRACT = 1;
const startedAt = new Date().toISOString();

function shortSha(value) {
  const sha = String(value || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : null;
}

function versionInfo(env = process.env) {
  return {
    service: 'fitness-app-backend',
    version: pkg.version,
    commit: shortSha(env.RAILWAY_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.SOURCE_COMMIT),
    builtAt: env.BUILD_TIMESTAMP || null,
    startedAt,
    contract: API_CONTRACT_VERSION,
    minClientContract: MIN_CLIENT_CONTRACT,
    environment: env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development',
  };
}

module.exports = { API_CONTRACT_VERSION, MIN_CLIENT_CONTRACT, versionInfo };

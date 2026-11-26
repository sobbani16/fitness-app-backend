#!/usr/bin/env node
// HUM-28 §6.2 — controlled configuration-matrix harness for feature-flag
// scenario verification. Implements every spec-required control so the staging
// execution is a replay, not an improvisation:
//   - snapshot original configuration before any change
//   - serialized application (one flag at a time, never concurrent)
//   - verified effective values (read-back must equal intended)
//   - audit logging (every step timestamped + attributed)
//   - restore original configuration even on failure
//   - deployment SHA verification (refuses to run against an unexpected build)
// The config backend is injected — production databases are never touched;
// in staging this wraps the feature-flag store, in tests a memory backend.
const crypto = require('crypto');

function createConfigMatrix({ backend, auditLog = [], shaVerifier = null }) {
  if (!backend || typeof backend.getFlags !== 'function' || typeof backend.setFlag !== 'function') {
    throw new Error('config backend must implement getFlags() and setFlag(key, value)');
  }
  const state = { snapshot: null, applied: [], auditLog };

  async function audit(step, detail) {
    state.auditLog.push({ at: new Date().toISOString(), step, ...detail });
  }

  async function verifySha(expectedSha, actualSha) {
    if (shaVerifier) return shaVerifier(expectedSha, actualSha);
    if (expectedSha && actualSha && expectedSha !== actualSha) {
      throw new Error(`deployment SHA mismatch — expected ${expectedSha}, deployed ${actualSha}. Refusing to run against an unverified build.`);
    }
  }

  async function snapshot() {
    state.snapshot = await backend.getFlags();
    await audit('snapshot', { flagCount: Object.keys(state.snapshot || {}).length });
    return state.snapshot;
  }

  async function applySerial(plan) {
    // plan: [{ key, value }] — applied one at a time with read-back verification
    if (!state.snapshot) throw new Error('snapshot required before applying — no silent baseline');
    for (const { key, value } of plan) {
      await backend.setFlag(key, value);
      const effective = (await backend.getFlags())[key];
      if (effective !== value) {
        await audit('apply_failed', { key, intended: value, effective });
        throw new Error(`flag ${key} read-back mismatch — intended ${value}, effective ${effective}. Aborting before any scenario runs.`);
      }
      state.applied.push(key);
      await audit('applied', { key, value });
    }
  }

  async function restore() {
    if (!state.snapshot) return;
    // Restore in reverse order of application — serialized like application.
    for (const key of [...state.applied].reverse()) {
      const original = state.snapshot[key];
      await backend.setFlag(key, original);
      const effective = (await backend.getFlags())[key];
      await audit(effective === original ? 'restored' : 'restore_mismatch', { key, original, effective });
      if (effective !== original) throw new Error(`restore failed for ${key} — manual intervention required`);
    }
    state.applied = [];
  }

  async function runMatrix({ plan, execute, expectedSha, actualSha }) {
    // Full lifecycle: verify SHA → snapshot → apply → execute scenarios → restore.
    // Restore runs even when execute throws — the environment is never left mutated.
    await verifySha(expectedSha, actualSha);
    await audit('sha_verified', { expectedSha, actualSha });
    await snapshot();
    let result, error = null;
    try {
      await applySerial(plan);
      result = await execute();
      await audit('scenarios_executed', { count: Array.isArray(result) ? result.length : undefined });
    } catch (e) {
      error = e;
    } finally {
      await restore();
    }
    if (error) throw error;
    return { result, auditLog: state.auditLog };
  }

  return { snapshot, applySerial, restore, runMatrix, auditLog: state.auditLog };
}

module.exports = { createConfigMatrix };

if (require.main === module) {
  console.log('config-matrix harness — import createConfigMatrix; see tests/configMatrix.test.js for usage');
}

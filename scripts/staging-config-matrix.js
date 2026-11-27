#!/usr/bin/env node
// HUM-28 §6.2 — controlled configuration-matrix harness for feature-flag
// scenario verification. Implements every spec-required control so the staging
// execution is a replay, not an improvisation:
//   - nonempty matching reviewed+deployed SHAs REQUIRED before any snapshot/scenario
//   - snapshot original configuration before any change
//   - every planned key must have an exactly-restorable baseline — rejected before any write
//   - serialized application; every ATTEMPT tracked before the setter is even called
//   - read-back verification per write (mismatch aborts before scenarios run)
//   - reverse-order restore of every attempted key — a failed restore never
//     skips the remaining keys; all restore failures are reported WITHOUT
//     losing the original execution error
//   - audit logging (every step timestamped)
// The config backend is injected — production databases are never touched;
// in staging this wraps the feature-flag store, in tests a memory backend.

function createConfigMatrix({ backend, auditLog = [], shaVerifier = null }) {
  if (!backend || typeof backend.getFlags !== 'function' || typeof backend.setFlag !== 'function') {
    throw new Error('config backend must implement getFlags() and setFlag(key, value)');
  }
  const state = { snapshot: null, attempted: [], auditLog };

  async function audit(step, detail) {
    state.auditLog.push({ at: new Date().toISOString(), step, ...detail });
  }

  // Identity gate: BOTH SHAs must be present, nonempty, and equal. A missing
  // or mismatched identity refuses before any state is even read for mutation.
  async function verifySha(expectedSha, actualSha) {
    if (shaVerifier) return shaVerifier(expectedSha, actualSha);
    const clean = (s) => (typeof s === 'string' ? s.trim() : '');
    const exp = clean(expectedSha);
    const act = clean(actualSha);
    if (!exp || !act) {
      throw new Error(`deployment identity incomplete — reviewed SHA ${exp ? 'present' : 'MISSING'}, deployed SHA ${act ? 'present' : 'MISSING'}. Refusing to run against an unidentified build.`);
    }
    if (exp !== act) {
      throw new Error(`deployment SHA mismatch — expected ${exp}, deployed ${act}. Refusing to run against an unverified build.`);
    }
  }

  async function snapshot() {
    state.snapshot = await backend.getFlags();
    await audit('snapshot', { flagCount: Object.keys(state.snapshot || {}).length });
    return state.snapshot;
  }

  // Pre-write gate: every key in the plan must have a well-defined baseline in
  // the snapshot — otherwise rollback could never restore it exactly, and the
  // matrix would leave the environment permanently mutated on first write.
  function assertRestorableBaseline(plan) {
    for (const { key } of plan) {
      if (!state.snapshot || !(key in state.snapshot)) {
        throw new Error(`baseline for flag ${key} is undefined — cannot guarantee exact restoration. Rejecting before any write.`);
      }
    }
  }

  async function applySerial(plan) {
    if (!state.snapshot) throw new Error('snapshot required before applying — no silent baseline');
    assertRestorableBaseline(plan);
    for (const { key, value } of plan) {
      // Track the attempt BEFORE the setter runs — a setter that mutates and
      // then throws must still be covered by restoration.
      if (!state.attempted.includes(key)) state.attempted.push(key);
      await audit('attempting', { key, value });
      await backend.setFlag(key, value);
      const effective = (await backend.getFlags())[key];
      if (effective !== value) {
        await audit('apply_failed', { key, intended: value, effective });
        throw new Error(`flag ${key} read-back mismatch — intended ${value}, effective ${effective}. Aborting before any scenario runs.`);
      }
      await audit('applied', { key, value });
    }
  }

  // Restore EVERY attempted key in reverse order. A failing restore never
  // skips the remaining keys — all failures are collected and reported.
  async function restore() {
    const failures = [];
    if (!state.snapshot) return { failures };
    for (const key of [...state.attempted].reverse()) {
      const original = state.snapshot[key];
      try {
        await backend.setFlag(key, original);
        const effective = (await backend.getFlags())[key];
        if (effective === original) {
          await audit('restored', { key });
        } else {
          await audit('restore_mismatch', { key, original, effective });
          failures.push({ key, kind: 'mismatch', original, effective });
        }
      } catch (e) {
        await audit('restore_error', { key, error: e.message });
        failures.push({ key, kind: 'error', error: e.message });
      }
    }
    state.attempted = [];
    return { failures };
  }

  async function runMatrix({ plan, execute, expectedSha, actualSha }) {
    // Identity first — before any snapshot or mutation decision.
    await verifySha(expectedSha, actualSha);
    await audit('sha_verified', { expectedSha });
    await snapshot();
    let result, error = null;
    try {
      await applySerial(plan);
      result = await execute();
      await audit('scenarios_executed', { count: Array.isArray(result) ? result.length : undefined });
    } catch (e) {
      error = e;
    } finally {
      var { failures } = await restore();
    }
    // Report restore failures WITHOUT losing the original error: the original
    // failure stays primary; restore state is attached for operators.
    if (error) {
      if (failures.length) error.restoreFailures = failures;
      throw error;
    }
    if (failures.length) {
      const e = new Error(`restore incomplete — ${failures.length} key(s) not restored: ${failures.map((f) => f.key).join(', ')}. Manual intervention required.`);
      e.restoreFailures = failures;
      throw e;
    }
    return { result, auditLog: state.auditLog };
  }

  return { snapshot, applySerial, restore, runMatrix, auditLog: state.auditLog };
}

module.exports = { createConfigMatrix };

if (require.main === module) {
  console.log('config-matrix harness — import createConfigMatrix; see tests/configMatrix.test.js for usage');
}

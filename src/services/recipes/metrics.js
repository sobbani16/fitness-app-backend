// Privacy-conscious recipe-intelligence counters (Phase 17, in-process).
//
// Counts events only — never user content, health details, or prompt text.
// Multi-instance deployments should swap the Map for Redis/DB like the
// aiProvider quota notes suggest; the key set is stable either way.

const counters = new Map();
const started = Date.now();

function inc(key, n = 1) {
  counters.set(key, (counters.get(key) || 0) + n);
}

const snapshot = () => ({
  sinceMs: Date.now() - started,
  counters: Object.fromEntries([...counters.entries()].sort()),
});

const _reset = () => counters.clear();

module.exports = { inc, snapshot, _reset };

# Exercise Intelligence — Master Execution Ledger

Canonical execution record for the pose-ML program (HUM-100 lineage).
Entries are append-only per program key; evidence cites commit SHAs and
test output. Synthetic results are smoke evidence only and are never
presented as real-world validation.

## K — Training pipeline and model registry (HUM-110)

### Synthetic smoke evidence (2026-11-26)

- Pipeline: `pose/training/pipeline.py` — reproducible deterministic-baseline
  trainer over synthetic sinusoidal joint-angle fixtures with stable
  participant/session ids (`syn_pNN`, `syn_pNN_sNN`).
- Split contract (spec §18): whole participant groups assigned to train /
  held-out BEFORE fitting, deterministically from the seed; participant OR
  session overlap across the boundary is a hard error
  (`validate_disjoint`); both partitions guaranteed nonempty.
- Latest synthetic smoke run: `n_train=36` (6 participants), `n_heldout=12`
  (2 participants), train accuracy 0.861, held-out accuracy 0.917 — smoke
  evidence only, demonstrates pipeline mechanics and split integrity, NOT
  exercise-recognition performance.
- Export posture: synthetic checkpoints export locally with
  `export.eligible=false` and NO registry-ready payload — smoke evidence
  cannot enter the §20/§32 registry pipeline even by accident.
- Verification: `tests/poseTrainingPipeline.test.js` 9/9 — split
  reproducibility, participant/session overlap rejection, group disjointness,
  train/heldout metric separation with sample counts, absence of registry
  output, fitting independence from held-out rows.
- Registry (shipped earlier): state machine registered→candidate→approved→
  active with baseline-comparison gate and append-only rollout events;
  HTTP surface admin-gated; mobile runtime consumes manifest with baseline
  fallback.

### Manifest metadata preflight (2026-11-26, HUM-100-K)

- Contract: `src/services/pose/datasetManifestPreflight.js` — every dataset
  manifest must pass preflight before any training run consumes it (spec
  §15/§18/§42 ML quality gates). Two layers: structural metadata, then
  source licensing (structure must be sound before sources are evaluated).
- Structural gates: schema shape + expected dataset version match, unique
  subject ids, train/validation/test forming a NONEMPTY, DISJOINT,
  EXHAUSTIVE partition of declared subjects (duplicates, unknown subjects,
  and omitted subjects each rejected distinctly), unique source ids, valid
  lowercase sha256 digests, valid source kinds, retention contract present.
- Licensing gates: because the v1 manifest does not attribute sources to
  individual splits, EVERY declared source must be explicitly suitable and
  allowed for BOTH training and evaluation via the licensing registry —
  unknown (default-prohibited), restricted, prohibited, and smoke-only
  (synthetic-fixtures) sources are each rejected with distinct codes.
- Diagnostic hygiene: rejections use stable error codes only — subject
  pseudonyms and storage references never appear in output (regression-
  tested).
- Evidence: `tests/poseDatasetManifestPreflight.test.js` 16/16 — valid
  partition accepted; 9 structural rejection cases; 5 licensing rejection
  cases; hygiene sweep. Licensing + training-pipeline regression suites
  green alongside.
- Still outstanding under K before any real training run: recording-session
  integrity checks (per-clip sha256 verification against manifests), consent
  record cross-validation against the P3 platform consent ledger, artifact
  checksum verification at export time, and the §20 acceptance evaluation on
  real held-out data — all blocked on needs_human decision #97 (footage +
  compute).

### Artifact integrity verification (2026-11-26, HUM-100-K)

- Contract: export prints `artifact_sha256` — SHA-256 over the exact byte
  stream written to disk (serialized once, written once, hashed once). The
  digest is the export record; it cannot live inside the file it covers.
  The pre-existing embedded `checksumSha256` (model-parameter blob only)
  and the checkpoint format are unchanged.
- Verification: `pose/training/verify_checkpoint.py --checkpoint <path>
  --sha256 <digest-from-export-record>` re-computes the digest over file
  bytes independently and exits nonzero with clear diagnostics for mismatch
  (exit 1), malformed digest, or unreadable file (exit 2).
- Why both checksums: the embedded checksum covers only the model parameter
  blob — evaluation-metadata-only tampering (inflating held-out accuracy)
  leaves it unchanged. The artifact digest covers every byte and catches it.
  Proven by regression test.
- Usage: run export, copy the `artifact_sha256` line from stdout, verify any
  copy of the checkpoint before consumption.
- Evidence: `tests/poseTrainingPipeline.test.js` 13/13 — identical runs →
  bit-identical bytes and digests; untouched checkpoint verifies against the
  printed record; metadata-only edit rejected while embedded checksum stays
  constant; malformed digest and unreadable file rejected. Decisive lines:
  PASS `artifact bytes match export record` (sha 5ab1fe4b… on canonical
  config); FAIL `artifact digest mismatch` after held-out accuracy tamper.
- Distinct remaining checks under K: consent-record cross-validation against
  the P3 consent ledger (per-participant scope + revocation freshness),
  recording-session integrity (per-clip sha256 against manifest digests),
  and the §20 real-world acceptance evaluation — all blocked on needs_human
  decision #97 (footage + compute).

### Outstanding real-world validation (BLOCKED)

- Real consented footage for the 5+1 target exercises (multi-view,
  deviation + occlusion cases) and training compute — needs_human
  decision #97. Until real data exists: no ML-architecture training, no
  real acceptance evaluation per §20 thresholds, no registry registration
  of any model. Synthetic smoke evidence must never be cited as acceptance
  evidence.

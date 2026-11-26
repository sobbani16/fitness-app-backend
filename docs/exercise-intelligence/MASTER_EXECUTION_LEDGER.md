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

### Outstanding real-world validation (BLOCKED)

- Real consented footage for the 5+1 target exercises (multi-view,
  deviation + occlusion cases) and training compute — needs_human
  decision #97. Until real data exists: no ML-architecture training, no
  real acceptance evaluation per §20 thresholds, no registry registration
  of any model. Synthetic smoke evidence must never be cited as acceptance
  evidence.

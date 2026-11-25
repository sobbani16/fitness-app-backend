# Pose dataset playbook (pc-HUM-68 / DEV4)

Status: **infra ready — BLOCKED on licensed footage + training compute** (per the card rule: no real data → infra + playbook + BLOCKED). This playbook defines how footage is collected, licensed, consented, annotated, QC'd, split, stored, and deleted. Schemas are machine-enforced via `pose/dataset/*.schema.json` + `src/services/pose/datasetSchema.js`.

## 1. Scope & exercises

Five exercises: `squat`, `push_up`, `lunge`, `deadlift`, `shoulder_press`.

Per exercise, the collection matrix requires coverage of:
- **Views**: `front`, `side`, `front_45`, `rear_45`, `rear` (phone at knee→chest height, self-recorded).
- **Variations**: e.g. goblet/sumo squat, incline/knee push-up — free-text `variation` field.
- **Deviation cases**: deliberate rubric deviations (knee_valgus, lumbar_flexion, elbow_flare, partial_range, …) — minimum 25% of reps per exercise so form eval has positive cases.
- **Hard cases**: `uncertain` rep boundaries and `occluded` reps are first-class fields, not discards — the model must learn abstention behavior from them.
- **Diversity**: subjects varied across body type, skin tone, clothing, lighting, camera distance/angle. No single subject may dominate a split.

## 2. Consent workflow + source rights

Every clip maps to exactly one `consent-record` (`consent-record.schema.json`):

- **Consent instrument**: signed before capture; scope items are `training`, `evaluation`, `model_derivatives`, `benchmark_publication` — a clip may only be used for scopes in its record. Minor subjects require `guardian: true`.
- **Source rights kinds**: `in_house_capture` (our shoots), `licensed_dataset` (requires `licenseId` + `termsReviewedBy`), `subject_contributed` (in-app submissions with consent), `public_domain` (requires rightsNotes justification). **Never scrape or use unlicensed footage — no exceptions.**
- **Revocation**: `revocable` + `channel` are mandatory. `revokedAt` triggers the deletion cascade (§6).

## 3. Annotation workflow

Per `annotation.schema.json`, each clip carries:
- `reps[]`: `startFrame`/`endFrame` boundaries + optional `phases[]` (`descent`/`bottom`/`ascent`/`top`/`setup`/`lockout`) + `uncertain`/`occluded` flags.
- `labels.technique[]`: deviation codes from the exercise rubric; `labels.form` ∈ acceptable/minor/major/unsafe.
- `annotator`: `id`, `annotatedAt`, `reviewedBy`/`reviewedAt`, `agreement` (inter-annotator score where double-labeled), `rubricVersion`.

QC rules: ≥20% of clips double-annotated; agreement <0.8 → re-annotate; all `unsafe` labels get mandatory second review. `rubricVersion` changes require schema review, never silent edits.

## 4. Splits — participant-disjoint

`manifest.schema.json` partitions `subjects` across `train`/`validation`/`test` — the validator (`datasetSchema.validateManifest`) rejects overlap, undeclared subjects, and unassigned subjects. A subject's clips all live in exactly one split; "unseen people" eval honesty depends on this. Target 70/15/15 by subject count, stratified by exercise mix.

## 5. Access & storage

- **Raw footage**: `retention.rawAccess` = `restricted_role` — raw frames accessible only to a named annotation role; training pipelines read derived keypoint tensors, not raw media.
- **Pseudonymization**: subjects exist only as `subjectPseudonym` — never names/emails/user ids in any artifact.
- **Provenance**: every source has a `sha256` + `consentRecordRef` in the manifest; unverifiable footage is excluded.

## 6. Deletion & retention cascade

On `revokedAt` (or `retentionUntil` expiry): (1) remove raw footage, (2) remove/re-derive annotations and keypoint tensors, (3) flag trained checkpoints containing the subject for retrain-from-scratch review (weights are not per-subject deletable — this is a policy disclosure), (4) write a deletion audit entry, (5) regenerate the manifest with the subject removed.

## 7. Model evaluation contract (DEV4 models)

Eval reports per exercise: rep precision/recall, rep-count MAE, form deviation P/R/F1, false-correction rate, calibration (ECE on confidence), abstention coverage (uncertain/occluded clips must yield abstentions, not guesses), cross-view robustness deltas, **unseen-people** (test-split subjects never in train), latency + memory on target device. Classical baseline → TCN → LSTM/GRU → light transformer, same normalization/mask/view-metadata inputs, fixed seeds, versioned checkpoints. No invented benchmarks.

## 8. The BLOCKED ask

`needs_human`: licensed/consented footage for the 5 exercises (collection shoot or licensed dataset) **and** training compute. Everything else — schemas, consent records, manifest validation, rubric, eval contract — is ready.

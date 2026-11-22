# Scenario Review Fixture Handoff

## Engineering-complete (7) — needs reviewer-authored fixture, NOT clinical sign-off
A08, A09, H04, H06, L03, L04, L05 — service + authenticated-API evidence exists (`data/scenarioEvidence.async.json`, `tests/asyncScenarios.api.test.js` 7/7). Each is deterministic engineering behavior: no medical-content approval is required unless the scenario spec names one. Reviewer action: author the acceptance fixture named in the package → matrix generator promotes on evidence+fixture.

## Clinical-dependent (8) — packages preserved
H01, H02, H03, H05, H07, D02, E04, G04 — see `CLINICAL_REVIEW_HANDOFF.md`: original expectation, engineering evidence, missing clinical thresholds, required specialty, proposed acceptance fixture, activation dependencies. No fabricated approvals; flags OFF.

## Fixture packages — per-scenario (7 engineering-complete)

| ID | Expectation (verbatim basis) | Evidence already held | Reviewer fixture needed |
|---|---|---|---|
| A08 | Symptom recording + history list | API POST/GET 201/200, owner-scoped | Reviewer-signed fixture: "non-clinical record-keeping, no diagnosis implied" |
| A09 | Symptom update/delete | PATCH/DELETE owner-scoped, 404 cross-user | Same class — engineering reviewer suffices |
| H04 | Co-occurrence observation (non-causal) | `trends.reviews` emits observation w/o causal claim | Fixture asserting wording stays non-causal |
| H06 | Flag-off → graceful degradation | fail-closed 403/404 verified | Engineering reviewer: behavior unchanged when flag off |
| L03 | Outcome divergence → review surface | divergence lands in trends.reviews | Fixture naming expected review payload |
| L04 | Symptom persistence status | PATCH persistence field owner-scoped | Engineering reviewer |
| L05 | Cross-user isolation | 404 on foreign id | Engineering reviewer — security invariant |

All seven are **non-clinical engineering behaviors** — a qualified engineering/security reviewer (not a clinician) can author fixtures. No medical content involved.

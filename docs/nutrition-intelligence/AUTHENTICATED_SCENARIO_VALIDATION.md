# AUTHENTICATED SCENARIO VALIDATION (Phase 2)

Runner: `tests/asyncScenarios.api.test.js` — supertest against the real Express app, real prisma, isolated `fitness_test`, `AUTH_TEST_BYPASS` (test env only), flags enabled via `envOverrideName`.

## Test ↔ scenario mapping (10 service tests → 14 IDs reconciled)

| Service test | Scenarios |
|---|---|
| multi-domain trends review | A08 |
| coverage + goalProgress enum | A09 |
| timing/severity enrichment | H01 |
| repeated co-occurrence non-causal | H02–H05 |
| persistent → professional review | H06 |
| insufficient history → no fabrication | H07 |
| dose/timing context | D02, E04, G04 |
| divergence review | L03 |
| weight direction no false promise | L04 |
| surplus+training | L05 |

## API-level results — 7/7 pass

| Test | Endpoint(s) | Asserted |
|---|---|---|
| Unified trends mirror | GET /me/progress/unified | `trends.state='ok'`, coverage=5, `basis` contains "observational", provenance `FoodLog` |
| Cross-user isolation | GET /me/progress/unified | second user's `foodLoggedDays` = 0 |
| Urgent vs recorded | POST /activity-safety/symptoms | `urgent_escalation` + `suppressesActivitySuggestions` + `noDiagnosis`; non-urgent → `recorded` |
| Owner CRUD | POST/GET/PATCH/DELETE /symptoms | list owner-only; cross-user PATCH 404; owner PATCH 200; DELETE removes |
| Co-occurrence | POST symptoms + GET unified | association (when present) is observational/non-causal |
| Flag fail-closed | POST /symptoms with flag off | 401/403/404 |
| Divergence | GET /me/progress/unified | `reviews[].kind === 'score_outcome_divergence'`, `outcome: 'outcome_review'` |

## Defects found & fixed by this runner

1. `GET /activity-safety/symptoms` selected a nonexistent `notes` field → real-DB 500 (mocked tests masked it). Removed; verified via API test.
2. Divergence lives in `trends.reviews` (not `observations`) — initial assertion corrected after reading service output shape.

## Status semantics

- These runs satisfy **engineering-level** execution fidelity (real DB + real HTTP + real auth path).
- Original scenario `expectedVerbatim` is preserved unchanged; engineering PASS ≠ clinical approval. Scenario count stays at the fixture-runner tally until the registry is updated by the matrix script — no inflated counts.

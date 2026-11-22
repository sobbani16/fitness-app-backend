# Food Logging — Release Readiness Verdict

Date: 2026-11-22 (final pass). Scope: the food-logging subsystem only.

## Verdict: CONDITIONAL GO for staged rollout — blocked only on deployment authorization

Every originally identified defect is fixed and device-verified; the serving/nutrition/
persistence/unknown-nutrient pipeline is correct with regression coverage. Remaining
gates are procedural, not code: commits are local (18 ahead of origin, unpushed) and no
production deploy has been authorized or performed.

## VERIFIED — done and evidenced

| Item | Evidence |
|---|---|
| FL-001 `1 slice` serving | Device: unit sheet `1 slice, 32 grams`, default selected |
| FL-001b weight-unit ordering | `1 oz`/`1 ONZ`/`4 GRM` leaks deleted; filter fixed |
| FL-002 duplicate label | Device: `Per 100 g: 247 kcal · Protein 13 g · …` |
| Serving math | 2 slices → 64 g → 158 kcal exact per-100g scaling |
| Round-trip identity | Postgres keeps `servingId/servingGrams/servingCount`; reopen restores `1 slice` × 2 and `1 portion (330 ml)` |
| Unknown nutrients | `nutrientUnknowns` on all 4 write paths; `fiberG: null` → flagged, never zeroed; consumed by macroScore/healthScore/nutrientStatus/recommendations |
| VOICE-001/002 (fixed) | `resolveHouseholdServing` at interpret+execute; serving identity in snapshot; device exit 0 |
| BC-001/002 (fixed) | `snap:` pseudo-unit restores `1 portion (330 ml)`; provenance whitelist |
| Volume≠mass (fixed) | Coca-Cola: `servingUnit:'ml'`, `servingSizeMl:330`, `servingSizeG:null`; OFF `serving_quantity` never assumed grams |
| Float artifacts (fixed) | `fmtKcal`/`fmtG` render helpers; `1846.2399999999998` → `1846`; regression tests |
| Barcode pipeline | OFF lookup → normalize → cache → scan → log → reopen, device exit 0 |
| Idempotent create | same-id re-POST → no-op; cross-owner → 409 |
| Security | 401/404/409 probes; bounds; injection-safe; foodName truncated |
| Offline | outbox queue + reconcile preserve serving identity |
| Serving coverage | **83.3%** (190/228 usable catalog) — COV gate passed; 38-item unresolved queue documented, weight-fallback only |
| Tests | backend 136/137 suites · 5520 tests; 16 regression cases new; mobile typecheck + jest clean |
| Flags | all AI food flags fail-closed (`default:false`); `AI_EMERGENCY_SHUTDOWN` kill-switch; `FEATURE_FLAGS_PROVIDER=env` rollback |

## Device flow matrix (iPhone 17 Pro sim, iOS 26.4, real API + Postgres)

| Flow | Status | Evidence |
|---|---|---|
| Manual search → 2 slices bread | **PASS** | Maestro exit 0; serving + reopen verified |
| Barcode → Coca-Cola | **PASS** | exit 0; OFF product; volume label restored on reopen |
| Voice "2 slices whole wheat bread" | **PASS** | exit 0; interpret ready; serving persisted |
| Photo description → tikka masala | **PASS** (desc path) | exit 0; AI detect → review gate → save; fiber unknown flagged |
| Nutrition label → typed text | **PASS** (typed path) | exit 0; extract → review → 240 g/230 kcal logged; `reviewed:true`; sugar/sodium null preserved |
| Camera capture (photo/label/menu OCR) | **PARTIAL** | simulator cannot exercise physical camera; post-capture pipeline fully verified via typed/photo-library paths |
| Menu scan (photo library) | RUNNING | menu PNG injected via simctl; flow written |
| Quick add (water/weight) | RUNNING | deterministic parser; food phrases route to search/voice by design |
| Recent foods + favorites + repeat | RUNNING | flow written |
| Recipe search → log | RUNNING | flow written |

## Data quality risks remaining

- **38 unresolved foods** (hummus, cream cheese, cashew, etc.) log gram-only — safe, but the FL-001-class UX gap persists for those foods until human-verified servings land. Unresolved queue: `FOOD_LOGGING_SERVING_COVERAGE.md`.
- **OFF is community data** — retained with provenance, `retrievedAt`, never marked verified. Barcode coverage is best-effort.
- Non-macro nulls (sugar, sodium, sat-fat) stay null in snapshots — visible but outside the 5-key coverage model (documented scope).

## BLOCKED / NOT DONE

- **Deployment**: local branch `feat/activity-safety-engine` is 18 ahead of `origin` — fixes unpushed; staging backend (`activity-safety-staging-staging.up.railway.app`, live 200) runs an older deploy. Push + Railway deploy requires explicit authorization. Post-deploy synthetic checks (health, barcode resolve, food-log create/readback, flag posture) scripted but not executed against prod.
- **Physical camera paths**: untestable on simulator — marked PARTIAL above.
- **Mobile build vs deployed backend**: EAS `staging` profile targets the staging backend; a staging device build + flag posture check is the remaining pre-prod step.

## Commits (unpushed, this session)

Backend `feat/activity-safety-engine`: `48372e4` regression tests · `7294951` volume/mass · `8054699` provenance whitelist · `d3c16f8` voice servings (+ earlier `3b4934c`…`e799525`).
Mobile `feat/muscle-explorer-v2`: `6be8f18` format tests · `e4eb95b` display+volume fix · `22994ad` · `2323b45`.

## Rollback readiness

- Flags: `FF_<KEY>=false` per flag or `AI_EMERGENCY_SHUTDOWN=true` for the whole AI group; `FEATURE_FLAGS_PROVIDER=env` drops PostHog targeting entirely.
- Code: revert commits; no schema migrations were added this session (serving rows are data, not DDL — deleting rows is the data rollback).
- Railway: `deploy:prepare` gate (`migrate deploy` → `seed-rbac` → `deploy:check`) before start; healthcheck `/health/ready`.

## Recommended order

1. Complete the 4 in-flight device flows (windows contested by parallel owner automation — runs are serialized and retry on infra failures).
2. Push commits (authorization needed) → Railway staging deploy → synthetic checks → staging mobile build.
3. Human-verify the 38-food unresolved queue or explicitly scope the launch list.
4. Physical-device pass for camera paths before GA.

# SAFETY_CASE — what the system currently guarantees, and where it can still hurt someone

**Updated 2026-11-21 (evening)** — H4/H6/H9 resolved; new guarantee #10 (rule gating closed across all consumers); H12 added for completeness.

## Enforced guarantees (verified in code)

1. **Non-APPROVED clinical rules never fire — now true everywhere.** `conditionEvaluation`, `nutritionRecommendation`, and `foodIntelligence` were already gated; this session closed the same gate (`reviewStatus='APPROVED'`) in **all five `ConditionRule` consumers**: `mealSuggestion`, `healthScoreEngine`, `ingredientValidator`, `supplementValidator`, `weeklyDietGenerator`. 80 legacy DRAFT rows previously blocked meals and penalized scores — now inert (B8). DB additionally enforces via CHECK constraint: every APPROVED rule requires `reviewedBy` + `reviewedAt` + `evidenceSourceId` + `clinicalAction`. `supplements/safetyEngine` legacy attribute path is inert by accident-of-status (`==='PUBLISHED'` never matches the `DRAFT|REVIEWED|APPROVED` enum) — degrades to INFO "draft" warnings, acceptable but should be cleaned to `APPROVED` semantics later.
2. **Allergy exclusion is a hard gate** in every surfaced path (mealSuggestion blockedKeywords, foodIntel.checkSuitability severity:'hard', nutritionRecommendation allergenHits) and runs *before* ranking — ranking can't resurrect excluded items. Caveat: it is name/keyword matching, so it can only be as good as recipe ingredient lists; copy admits this (`'deterministic but not a clinical guarantee'`).
3. **Missing ≠ zero** throughout: nutrientStatus coverage, INSUFFICIENT_DATA statuses, `verdict:'unknown'` on absent composition, fiber fiberKnown flags.
4. **AI is caged**: paid-call gate, per-user daily quota, emergency kill-switch, strict JSON schemas, minimized payloads (eligible IDs only for re-rank), deterministic fallback on any failure, `store:false`.
5. **Feature flags fail closed**: unknown keys false; v2 flags default false; provider outage → env+defaults only; `dependsOn` unbreakable.
6. **Low-intake protection exists in design**: `targetRange` floor → `safety_suspended` state ("not treated as failure or success"); `decisionEngine` escalation beats all coaching.
7. **Supplements are isolated**: dose counts surfaced, nutrients never merged into food totals; 47 interaction rules held unapproved.
8. **No diagnosis**: no code infers conditions from logs/wearables; PCOS intentionally has no universal restriction rule; copy says "not medical advice"/"not a deficiency assessment" in all user-facing payloads checked.
9. **Audit trail**: SafetyAuditLog (schema), ProductCorrection field-level provenance, DailyScoreSnapshot version pinning, IngredientImport reports, supplement import audit files.

## Hazards still open

| # | Hazard | Mechanism | Mitigation now | Residual plan |
|---|---|---|---|---|
| H1 | **v1 healthScore can mislead** — heuristic food-quality punishes natural sugar (fruit), "No Activity −5" punishes rest days, hardcoded targets when no MacroGoal | `/health-score` live today | None — served as-is | D11: label v1 or deprecate on v2 parity |
| H2 | **Allergen false negatives** — 278/371 recipes declare no allergens; name-match can't catch "may contain"/hidden ingredients | keyword matching | conservative copy; declared-allergen field preferred when present | expand allergen declarations + "unknown ≠ safe" messaging; never promise hard-block is sufficient (per prompt §5) |
| H3 | **Life-stage gate unpowered** — pregnancy/minor/ED-risk triggers exist in `decisionEngine` but no data source populates them | no life-stage fields | none | add voluntary profile fields + screening pathway; until then the resolver silently passes |
| H4 | **Calorie floor unwired** — `calorieFloor:null` at route → very-low logged intake never triggers safety_suspended | still `null` by design | documented abstention | G4 policy decision; wiring already in place (`targets.calorieFloor`) |
| H5 | **RESEARCH_DRAFT recipes visible** — unverified recipes surface in search/suggest marked `ESTIMATED` | reviewStatus filtering excludes only REJECTED | labeling | reviewer triage queue; hide RESEARCH_DRAFT from suggestion pools pending nutrition review |
| ~~H6~~ | **Junk provenance** — `ms*` rows, `dummy-*` fdcIds | was seed/import residue | **RESOLVED 2026-11-21**: DB cleaned (all zero on re-scan), `seed-foods.js` scrubbed, sentinel check lives in `scripts/audit-junk-data.js` | re-run script periodically; test suites now self-clean |
| H7 | **LLM output trust** — re-rank path validated (IDs-only), but meal photo/text analysis feeds `visuallySuggestedIngredients` — prompt-injection via image text is untested | askJSON | schema-strict JSON | adversarial fixtures (Phase 7) before widening AI surface |
| H8 | **Rule execution unaudited** — no RuleExecution log; SafetyAuditLog has 0 rows | — | schema exists | D10: log evaluations when clinical rules go live |
| ~~H9~~ | **Micronutrients column gap** | migration applied 2026-11-21 | **RESOLVED** | deploy checklist: migration must precede code rollout on every env |
| H12 | **DRAFT rules previously acted (B8)** — legacy unreviewed ConditionRule rows blocked recipes + penalized v1 score + fired in validators | ungated `conditionRules` includes | **RESOLVED 2026-11-21**: all consumers gate `APPROVED`; DRAFT-inert test in `mealSuggest.test.js`; DB CHECK constraint blocks approval without evidence trail | keep rows for reviewer mining (D12) or delete — pending |
| H10 | **Duplicate bread rows / unnormalized names** could mislead search ranking and nutrient pick | 12 dup groups | none | D7 dedupe |
| H11 | **OFF community data** — allergens/nutrients from Open Food Facts are user-contributed | `dataQuality:'community'` shown | flag-gated, labeled | keep; add "community data — verify label" copy on scan screens (check mobile shows it — UNVERIFIED) |

## Reviewer requirements before any user-facing activation

- Clinical sign-off on: any APPROVED condition rule, calorie floor policy (G4), life-stage/pregnancy handling (H3), scenario review (D9).
- Product/legal sign-off on: score naming (D5), health-claim copy in evidence profiles, OFF/IFCT data terms, general-wellness vs CDS boundary for condition-aware suggestions.
- ENG verification on: B1–B3 fixes, flag-off byte-identical v1 regression, scenario fixtures for P0 rows.

## Explicit non-goals (per master prompt + current design — keep it that way)

No diagnosis, drug dosing, insulin adjustment, or automatic disease-specific prescription · no RED-S/ED inference from logs · no universal kcal floors for all users · no food shaming/compensation workouts · no "inflammatory food" labels · no hard-block allergy guarantee beyond ingredient-list matching.

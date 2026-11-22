# DECISIONS — open items needing owner input (updated 2026-11-21, evening)

**Resolved this session:** D1 (migrations applied via reviewed SQL), D3 (B1–B4 fixed + tested),
D4 (MacroGoal first, DV fallback, `targetSource` labeled), D7 (cleanup applied; see D12 for residue),
D8 (nutrient layer populated: 27 nutrients, 18 profiles, 12 evidence, 14+3 DRAFT rules, 120 scenarios).

Decisions already made by code are marked **DECIDED**. Open items marked **FOUNDER** (product), **CLINICAL** (reviewer), **COUNSEL** (legal), **DATA** (license), **ENG** (implementation choice — Devin may proceed unless overridden).

## Carried forward from docs/phase0/VALIDATION_REPORT.md (still unanswered)

- **G1** Retain fiber `kcal/1000×14`; replace other candidate formulas — *recommendation: accept* · FOUNDER
- **G2** 40/20/20/15/5 weights are product design, not clinical measure — shipped in dps-v2 caps · DECIDED (provisional, needs in-app labeling = D5)
- **G3** Weight-loss protein basis: 1.6 g/kg current vs 1.9 g/kg goal weight — *recommend 1.6–2.2 range, default 1.8 current* · CLINICAL
- **G4** Calorie floor: hard floor at max(1200, BMR×0.8)? — *needs policy; scoringV2 supports `calorieFloor` but route passes null (B3)* · CLINICAL + FOUNDER
- **G5** Rename "health score" → "day adherence score" · FOUNDER

## New decisions from this audit

- **D1 — Apply pending migrations locally?** · DECIDED — applied 2026-11-21 via reviewed manual SQL + `migrate resolve` (all 10 additive; existing drift checked first).
- **D2 — Consolidate recommendation + scoring front-doors.** Today: `recommendFromBalance`, `getMealSuggestions`, `suggestMeals` (3 recommenders) and `healthScoreEngine v1`, `dailyProgress v2`, `dps-v2` (3 scorers) plus `DailyMacroScore` (0 rows — dead?). *Recommend: pick `suggestMeals` + `dps-v2` as the v2 front-doors behind `nutrition_insights_v2`/`health_score_v2`; freeze v1, plan deprecation.* · FOUNDER
- **D3 — Fix B1 crash + B3 gaps in `/daily-progress/score-v2`?** · DECIDED — fixed 2026-11-21; `tests/scoreV2.route.test.js` (8 tests) locks behavior. `calorieFloor` stays null per G4.
- **D4 — score-v2 reference basis.** · DECIDED — `MacroGoal` first (kcal band = target ±20%, matching `computeDay` tolerance), FDA-DV fallback; `targetSource` (`macro_goal:<source>` | `fda_dv_reference`) exposed in response.
- **D5 — Naming/framing.** Keep "Daily Progress Score — adherence estimate" and never "health score" in v2 surfaces (G5). · FOUNDER
- **D6 — IFCT licensing.** No licensed export → `fromReviewed` stays closed; Indian coverage relies on USDA + humai-catalog (all `GENERIC_COMPOSITION`). *Options: obtain IFCT license, or label Indian dishes as estimates with ranges.* · DATA + COUNSEL
- **D7 — Junk data cleanup.** · DECIDED — `scripts/audit-junk-data.js` (dry-run default, `--apply` gated) removed 51 `ms*` ingredients, 54 `ms*` allergies, 55 `ms*` conditions, 66 `ms*` recipes; nulled 15 `dummy-*` fdcIds; deleted 1 impossible row (>900 kcal/100g is non-nullable → delete was only honest option). `seed-foods.js` scrubbed. **Note:** the `ms*` rows turned out to be *test-suite residue* (`ms<base36>` fixture prefixes), not seed bugs — `mealSuggest.test.js` now cleans up after itself.
- **D8 — Populate nutrient layer locally.** · DECIDED — done: 27 nutrients, 18 verified USDA profiles, 486 nutrient rows, 12 evidence, 14 nutrient rules + 3 clinical rules (all DRAFT), 120 scenarios.
- **D9 — Scenario review workflow.** 120 `pending_review` scenarios need human pass to become fixture specs; who reviews + in what tooling? · FOUNDER + CLINICAL
- **D10 — RuleExecution audit table.** Add one now (additive migration) while rule volume is tiny, or defer? · ENG
- **D11 — v1 `/health-score` interim behavior while v2 flagged off.** Options: leave (documented defects), label response as adherence-estimate, or disable. *Recommend: leave + label; removal waits for v2 parity.* · FOUNDER
- **D12 — Fate of legacy `ConditionRule` rows (was B8).** Legacy attribute rules (80 rows) all carried `reviewStatus=DRAFT` and were live in 4 consumers. Gated all five consumers to `APPROVED` on 2026-11-21 — **legacy rules are now inert by design**. Remaining: should legacy rows be bulk-annotated `legacy_import` and kept for reviewer mining, or deleted? *Recommend: keep — they document intended condition→attribute mappings; approval requires real evidence per row anyway.* · CLINICAL + FOUNDER. Also: 1817 `@test.dev` users + 12 normalizedName dup groups + `peanut`/`Peanuts` near-dup — pending cleanup policy (report-only in `junk-data-report.json`).

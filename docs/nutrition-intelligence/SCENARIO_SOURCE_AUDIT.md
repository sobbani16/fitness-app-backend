# SCENARIO_SOURCE_AUDIT — provenance of the 120-scenario spec (A01–L10)

**Investigated:** 2026-11-21 · resolves the independent review's HR-001 within its stated scope (repositories) — and finds the document outside them.

## Verdict

**The original Appendix A EXISTS and is now preserved in-repo** at `docs/nutrition-intelligence/APPENDIX_A.md` (verbatim, 455 lines). It was never committed to any repository — it lived in the user's local file `/Users/sobbani/Downloads/Humai_Fitness_Devin_Master_Prompt.md` lines 199–653 (the earlier *engineering* master prompt, distinct from the *nutrition* master prompt used at session start, which contains no scenario list).

## Where each artifact was found

| Artifact | Path | Git commit | Content |
|---|---|---|---|
| **Original spec (Appendix A)** | `~/Downloads/Humai_Fitness_Devin_Master_Prompt.md:199–653` | none — filesystem only | Verbatim product-owner material: 12 domains × 10 cases, each `ID \| Scenario (description) \| Expected behavior \| Priority`, plus section context + citation anchors (NIDDK, ACOG, ACSM, FDA, eatrightpro) |
| Preserved copy | `docs/nutrition-intelligence/APPENDIX_A.md` | this session | Verbatim extraction of lines 199–653 |
| Machine-readable manifest | `data/scenarioAppendixA.json` | this session | 120 entries `{id, scenario, expected, priority}` verbatim |
| Registry (reconstruction) | `data/scenarioRegistry.json` | `55fdc4d` (2026-11-21, "per master prompt") | 120 entries `{id, category, priority, expected}` — **AI-authored paraphrase** |
| DB mirror | `ScenarioDefinition` table (120 rows) | migration `20261120130000_scoring_v2_tables` / `fdf2a71`, seeded by `5f2e06b` `scripts/seed-scenarios.js` | now carries `scenario`+`expectedVerbatim` in `data` |
| Executable tests | `tests/scoringV2.test.js`, `tests/scoreV2.route.test.js` | `55fdc4d`+ | 12 IDs covered |
| Independent audit | `~/dev/audit/humai-independent-review/` (`SCENARIO_MATRIX.md`, `AUDIT_STATE.json`, `FINDINGS.jsonl`, `HUMAN_REVIEW_REQUIRED.md`) | — | HR-001 recorded the doc absent **in repos**; HF-0018 goal-taxonomy mismatch |
| Earlier blocker note | `docs/phase0/VALIDATION_REPORT.md` §D (commit `55fdc4d`) | — | "Appendix A … is not in either repository — supply it" |

## Fidelity diff — registry vs original (programmatic)

- IDs: **120/120 exact match** — zero missing, zero extra
- Priorities: **120/120 match** — zero mismatches (P0=50, P1=68, P2=2)
- Expected behavior: **2/120 verbatim, 118 paraphrased** (semantic paraphrases; e.g. A01 drops "possible effect on intended deficit")
- Scenario description column: **dropped entirely** in the original registry — **restored** this session (`scenario` + `expectedVerbatim` fields now in registry, manifest, and DB `data` blob; `expected` paraphrase kept for existing consumers)

## Per-field completeness (original Appendix A)

| Field per scenario | Present? |
|---|---|
| Scenario ID | ✔ all 120 |
| Description | ✔ all 120 (the `Scenario` column) |
| User goal | partial — stated in prose descriptions (e.g., "Weight-loss user"), not structured; §13 of the covering spec requires explicit applicability across 6 goals — **to be authored** |
| Required input data | ✖ not specified — §13 requires authoring |
| Nutrition/safety conditions | partial — in prose |
| Expected engine behavior | ✔ all 120 (prose, qualitative) |
| Scientific evidence | partial — section-level citation anchors (NIDDK, ACOG, ACSM, FDA, ADA, ISSN); not per-scenario citations |
| Test fixture | ✖ none |
| Actual test execution result | 12/120 (see below) |
| Validation status | registry `pending_review` — unchanged |

## Counts

- Fully specified per §13 fields: **0/120** (original supplies 4 of ~12 required fields)
- Partially specified (ID + description + expected + priority): **120/120**
- Missing scenario IDs: **0**
- Tested & passing: **12/120** (`executed_pass` in `SCENARIO_VALIDATION_MATRIX.md` + `var/scenario-matrix.json`)

## Still missing to complete validation (engineering work, not documents)

1. Per §13: explicit goal applicability, eligibility/safety gates, required/optional inputs, trigger logic, measurable expected outputs, fixtures, reviewer role — **must be authored per scenario and clinically reviewed** (D9 workflow). The original's qualitative expected text is the requirement; fixtures make it executable.
2. Goal-taxonomy fix (HF-0018): `fat_loss`, `bulking`, `maintenance` aren't accepted by profile API/`calorieEngine` — ≥2/6 goal profiles can't be exercised until unified.
3. Per-scenario evidence registration in `EVIDENCE_REGISTER.md` for any numeric threshold a fixture asserts.

## Decision for founder

Registry `expected` paraphrases are close but not verbatim (118/120). With `expectedVerbatim` now stored, validation should assert against the **verbatim** text; the paraphrase column can be retired after consumers migrate — recorded for review (not auto-changed).

**No scenario content was invented. The registry reconstruction is now superseded by the preserved original for specification purposes.**

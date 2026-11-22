# NEXT_STEPS — prioritized plan (updated 2026-11-21, evening)

Steps 0–2 from the previous version are DONE (migrations applied, nutrient layer populated,
score-v2 defects fixed, rule gating enforced, junk cleanup applied, `PIPELINE.md` written).
Remaining work, ordered safety-then-value. Commands assume `cd fitness-app-backend`.

## Step 3 — evidence + data foundation (next up)

- [ ] **3a.** Attach `RuleEvidence`-style records to `IngredientEvidenceProfile` claims (currently source strings only).
- [ ] **3b.** Add `expiresAt`/`reviewDueAt` + jurisdiction/population/certainty fields to evidence models (additive migration).
- [ ] **3c.** D6: IFCT — obtain license or explicitly scope "Indian coverage = USDA + labeled estimates".
- [ ] **3d.** Canonical-merge job for the 12 normalizedName dup groups (`bread`×9, `chicken curry`×3, pad-thai set) — repoint `UserIngredient`/`FoodLog`-adjacent links, archive losers. Extend `scripts/audit-junk-data.js` or a sibling script; dry-run first. Also `peanut`/`Peanuts` in `Allergy`. *(D12)*
- [ ] **3e.** Test-residue user sweep: 1817 `@test.dev` users. Large blast radius (FK Restrict chains) — needs its own reviewed script + explicit approval, or a policy decision to keep. *(D12)*
- [ ] **3f.** Nutrient profile coverage push: 510/529 ingredients unmatched — triage the 349 `NO_RELIABLE_SOURCE_MATCH` set (synonym/fuzzy matching to FDC?), resolve the 1 manual-review item (broccoli raw: FDC 170379 vs 747447).

## Step 4 — user context gaps (needs product decisions)

- [ ] **4a.** Life-stage fields (pregnancy/lactation/minor flag from DOB), voluntary medication disclosure, ED screening pathway — powers `decisionEngine` triggers that currently can never fire.
- [ ] **4b.** `confirmed` vs `inferred` marker on conditions/allergies.
- [ ] **4c.** Consent scope for nutrition analysis/education.

## Step 5 — taxonomy + education

- [ ] **5a.** Seed `IngredientAttribute` taxonomy (added-sugar carriers, refined grains, sodium-dense condiments incl. pickle/papad, trans-fat PHO, processed meat) — with rationale + counterexample metadata + source links.
- [ ] **5b.** Expand `foodEducation.json`; wire post-log education surface behind `nutrition_insights_v2`.
- [ ] **5c.** Substitution path: review `/food-intel/alternatives` for safety re-checks on substitutes; add tests.

## Step 6 — test hardening (gate before any enablement)

- [ ] **6a.** Golden fixtures per TEST_MATRIX gap list — Indian cooking set first (rice raw/cooked, dal tadka, paneer butter masala, ghee, almonds vs butter, juice, soda, hidden oil).
- [ ] **6b.** Adversarial suite (barcode/recipe text injection, forged `sourceCitation`, unit confusion, `fiberG=0` vs `null`).
- [ ] **6c.** Flag-off regression proving v1 responses unchanged.
- [ ] **6d.** Scenario review workflow (D9) — convert 120 `pending_review` scenarios into executable specs.
- [ ] **6e.** Extend `tests/scoringV2.test.js` fixtures: boundary values, overconsumption cap, floor suspension, conflicting snapshot, rest-day.

## Step 7 — staged release (only after 6)

- [ ] RuleExecution audit model (D10) — additive migration.
- [ ] Internal-test cohort (founder/admin allowlist via roles) → enable `health_score_v2`/`nutrition_insights_v2` for cohort only → telemetry on abstentions/`INSUFFICIENT_DATA` rates → rollback = flags off.

## Do NOT do (guardrails)

- Do not run `prisma migrate dev`/`migrate reset` (drift + data loss — AGENTS.md).
- Do not approve any condition rule without clinical reviewer identity (DB CHECK constraint enforces evidence+reviewer on APPROVED — don't work around it).
- Do not import IFCT without license evidence.
- Do not expose v2 surfaces to general users before Step 6.
- Do not merge supplement nutrients into food totals.
- Do not delete the 1817 test users or dup-name groups without a reviewed script — blast radius is real.

# CLINICAL_GOVERNANCE_IMPLEMENTATION — H9 verified state

**Implemented (verified in code):**
- `ClinicalRuleReview` enum: DRAFT → REVIEWED → APPROVED (schema).
- Rule fields: `reviewStatus`, `version`, `reviewedBy`, `reviewedAt`, `evidenceSourceId` (required RuleEvidence FK), `applicabilityCriteria`, `requiresPersonalization`, threshold value/unit/basis.
- **Every consumer filters `reviewStatus='APPROVED'`** — foodIntelligence.js, mealSuggestion.js, conditionEvaluation.js. No unapproved rule can reach users.
- **Approval ≠ activation**: medical feature flags (all OFF, fail-closed, medical group excluded from test auto-enable) are the independent activation gate. A rule can be APPROVED yet never fire if the flag is off.
- Admin review-transition route exists (`src/routes/admin.js:109`) gated by ACADEMY_CLINICAL_REVIEW flag.

**Gaps (honest, not implemented):**
- Enum lacks UNDER_REVIEW, ACTIVATED, SUSPENDED, RETIRED states — suspension today = flag OFF + reviewStatus revert; audit trail relies on reviewedBy/At fields only, no history table.
- No reviewer-role/permission model beyond admin gating; no country applicability field (schema has none on rules).
- No dedicated rule-history/rollback table — version is an int, not a linked chain.
- Reviewer packages (dietitian/physician/allergist/pharmacist/ED/OB) are documented in CLINICAL_REVIEW_HANDOFF.md + queues; no reviewer identities assigned (owner task).

**Safety invariants tested:** medicalFlagGovernance (11 tests) — defaults off, unknown-key fail-closed, no auto-enable, kill-group behavior.

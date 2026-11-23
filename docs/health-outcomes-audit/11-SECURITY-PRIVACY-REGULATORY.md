# 11 — Security, Privacy & Regulatory Assessment

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
Existing repo audits reused: `SECRETS_MANAGEMENT_AUDIT.md`, `FEATURE_FLAG_ARCHITECTURE_AUDIT.md`, `docs/audits/activity-safety-security-privacy.md`, trainer security test plans.

## 1. Verified controls

| Control | State | Evidence |
|---|---|---|
| AuthN | PASS | Global `authenticate` middleware rewrites `x-user-id` from verified session; Bearer tokens; AUTH_TEST_BYPASS only under NODE_ENV=test |
| AuthZ / isolation | PASS (spot) | Handlers use `req.userId` consistently; per-user rate-limit buckets (`user:<id>`); view-as is GET-only + super-admin + signed token |
| Input validation | PASS | `validateInput` middleware + per-route bounds (grams ≤20000, kcal ≤20000, record caps) |
| Rate limiting | PASS | `persistentLimiter` — IP 600 + user 120 req defaults |
| Secrets | PASS | Secrets via env; OPENAI_API_KEY never logged; startup validates presence only; prior secrets audit doc exists |
| AI data exposure | GOOD | Chat sends message text only (no user profile/conditions in prompt); system prompt forbids diagnosis; food images validated by `foodInput`; quotas bound exposure; kill-switch works |
| Consent | GOOD | Pose sessions require `consentToStore===true` (no-store = no write); activity profile has per-section `consentScopes` + `provenance`; reminder categories all default OFF |
| Deletion | PASS | `deleteAccount` purges all owned models, anonymizes purchase refs, keeps 35-day receipt; `exportAccount` exists |
| Trainer boundaries | PASS | TrainerClient + explicit consent (464 consent rows), consent-sharing UX, doc sharing via short-lived signed URLs |
| Audit logging | PASS | AuditLog 2861 + SafetyAuditLog 142 rows; evaluation provenance (policyVersion, ruleIds) |
| Injection hygiene | GOOD | AI prompts strip control chars/cap user-supplied names; "treat user content as untrusted data" |
| Transport/CORS | OK | helmet + env-driven origin allowlist; verify prod CORS_ORIGINS is set |

## 2. Gaps / risks

| ID | Sev | Finding |
|---|---|---|
| F-S1 | MEDIUM | No encryption-at-rest markers reviewed (DB-level); verify Postgres disk encryption + backup posture in prod (out of scope of this repo) |
| F-S2 | MEDIUM | Health-condition data (when added) becomes health data under multiple regimes — retention/deletion must be re-verified to include new tables (deletion iterates an `OWNED`/`INCLUDES` model list — **new tables must be registered or they orphan PHI**) |
| F-S3 | MEDIUM | Voice route writes injury/symptom records from parsed utterances (`voice.js:400,428`) — consent + review UX path exists but medico-legal consent text should be reviewed when conditions join it |
| F-S4 | LOW | `morgan` skips `/auth` + account paths (good); confirm no health-metrics payload logging under `/health-data` (morgan logs URL only — OK) |
| F-S5 | INFO | Test fixtures create real UserHealthCondition rows in non-test envs if `SAFETY_STATE_FIXTURE=1` — guard exists (env + module throws in prod) but ensure staging env vars aren't copied to prod |

## 3. Regulatory posture (assessment, not legal advice)

| Regime | Likely applicability | Rationale |
|---|---|---|
| HIPAA (US) | Probably **not** a covered entity/BAA situation for pure consumer app — BUT trainer/nutritionist paid-coaching flows and any provider integration can create hybrid exposure; if clinicians (covered entities) use the product to manage patients, BAA analysis required |
| FTC Health Breach Notification Rule | **Applies** — consumer health data (conditions, injuries, symptoms, measurements) outside HIPAA → HBNR duties on breach + truthful health-claims enforcement |
| State privacy laws (CCPA/CPRA + WA My Health My Data) | **Applies** — MHMD explicitly covers consumer health data incl. inferred conditions; requires opt-in consent, purpose limitation, deletion rights (already strong), no sale |
| India DPDP Act 2023 | **Applies** — health data is personal data; consent + purpose limitation + erasure; no special-category tier but fiduciary duties apply |
| FDA SaMD / Clinical Decision Support | KEY QUESTION — **non-device CDS** exemption (21st Century Cures §520(o)(1)(E)) likely holds while: recommendations are supportive/educational, display basis/sources, don't direct treatment, and clinician-independent users aren't the intended reviewers. **Risk rises sharply** if we: auto-titrate calories/meds-context, claim condition "management" for diagnosed disease, or produce recommendations a clinician would rely on without independent review. Education + general-wellness positioning + explicit "for clinician discussion" labels keep it under the line; any "remission" claim or insulin/dosing context crosses it |
| EU MDR (if distributed) | Similar analysis — likely out of scope while general-wellness; any disease-management claim re-enters scope |
| App-store policies | Apple 5.1.3 health-data + 1.4.1 medical-apps rules: no PHI in analytics/ads, medical advice disclaimer, data-use consent screens — architecture mostly satisfies; progress-sharing cards must not auto-post |

## 4. Features requiring legal/clinical review before release (gate list)

1. Any user-facing condition-specific recommendation (needs: claim boundaries + clinician sign-off of rules — governance already models this).
2. Lab-value interpretation (display w/ reference ranges OK; *interpretation* or alerts → medical-adjacent).
3. "Remission/outcome" claims in reports or share cards — highest regulatory risk; verify against DiRECT/ADA remission definitions and never imply causation.
4. Medication interaction warnings (pharmacist review; current posture "rules not yet active" disclosure is the right template).
5. Minors (under-18) — calorieSafety already refuses automated targets; confirm onboarding age gate at API level (gap analysis already flagged this).
6. Pregnancy/lactation guidance — ACOG-derived content requires clinical review.
7. Prompt-injection surface grows with imported external content (menus, labels, clinical text) — current hygiene good; extend to any clinical-content import.

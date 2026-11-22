# Activity Safety — Regulatory & Claims Handoff (for qualified counsel)

**Scope:** US (FDA) + India (CDSCO) review of the activity-safety, weather-intelligence,
and recommendation-gating subsystem. This package describes what the software does today;
it makes **no regulatory compliance determination**.

Companion documents (same repo, `feat/activity-safety-engine` branch):
- `docs/audits/activity-safety-claims-inventory.md` — feature→claim-class matrix + suppression recommendations
- `docs/clinical/activity-safety-review-package.md` — all 71 DRAFT rules with executable examples
- `docs/clinical/activity-safety-review-assignment.md` — per-rule qualification + version hashes
- `docs/audits/activity-safety-phase22-exercise-suitability.md` — recommendation audit

## 1. Intended use (as implemented)

A consumer fitness app that:
- logs meals/exercise, tracks macros, suggests general activity;
- optionally adjusts daily activity suggestions against **user-reported** injuries/symptoms
  and **user-entered or clinician-documented** restrictions;
- suppresses suggestions when safety cannot be established (`INSUFFICIENT_DATA`,
  `no_safe_candidate`), and shows a fixed escalation line for user-reported urgent symptoms;
- presents environmental context (weather, AQI, NWS/IMD alerts) and can defer *outdoor*
  suggestions on hazardous conditions.

## 2. Target audience

General consumers tracking personal fitness. Not marketed to clinicians, hospitals, or as
a professional triage tool. The trainer-facing surfaces are coach-client relationships,
not clinical care.

## 3. User-facing medical-ish statements (exact strings shipped)

- Suggestion framing: *"Based on today's conditions and your plan, {activity} could be an option."*
- Injury recorded: *"Recorded. Activity suggestions now account for it — this is a
  self-reported record, not a medical assessment."*
- Injury permanence: *"Temporary injuries adjust suggestions — never permanent bans."*
- Urgent symptoms: *"Do not begin a workout. Your reported symptoms may require urgent
  medical attention — contact local emergency services or seek urgent care."*
- No candidate: *"No activity suggestion today based on your current restrictions —
  if anything changed, review your safety profile or check with your clinician."*
- Safety report screen: deterministic non-diagnostic copy only (`v1 safety-copy boundary`).

Notable: no diagnosis, no "clinically validated", no cure/treat/prevent language anywhere
in the safety surface (`noDiagnosis:true` is asserted in API tests).

## 4. Recommendation decision architecture (why counsel should care)

Every suggestion producer (dashboard card, LLM coach, trainer-assigned plan, wearable/fallback,
notification send-time) passes through one server-side gate:

```
user context (injuries, symptoms, restrictions, conditions, mobility)
  × activity demand profile (catalogued weight-bearing/region/category demands)
  × environment (weather, AQI, alerts)
  → decision ∈ ALLOW | MODIFY | DEFER_OUTDOOR | BLOCK_ACTIVITY |
               NEEDS_CLINICAL_REVIEW | INSUFFICIENT_DATA | URGENT_ESCALATION
```

- Missing data never counts as favorable — unknown environment or demands yield
  `INSUFFICIENT_DATA`/defer, not "safe".
- Cached recommendations are invalidated (`staleAt`) on any safety-relevant change;
  reads and notification sends re-check at serve time.
- The engine is deterministic rule evaluation — not an LLM — so behavior is auditable
  (see `ruleIds`/`policyVersion` emitted per decision).

## 5. Safety-rule governance

- 71 rules, seeded **DRAFT**; only `APPROVED` rows can fire for users.
- APPROVED requires `reviewedBy`, `reviewedAt`, `evidenceSourceId` (DB CHECK).
- Each rule cites an evidence source (ACSM/PAR-Q+/APTA/ADA/EPA/ACOG etc.) in
  `docs/clinical/activity-safety-evidence-register.md`.
- `unsupported_input` rules stay inactive rather than inferring from signals the
  product cannot collect.
- All decisions are fail-closed: flags off ⇒ no safety features AND no legacy unsafe path.

## 6. Human-review workflow

`activity-safety-review-assignment.md` assigns each rule a required qualification
(emergency medicine / sports medicine / PT / pulmonology by effect type) and a
content hash. Reviewers record decisions in the adjudication queue; engineers record
APPROVED only against signed decisions. Re-approval triggers on any rule-hash change.

## 7. Supported regions

- Weather/AQI: Open-Meteo globally; NWS alerts (US), IMD-CAP alerts (India — live-verified);
  CPCB AQI labeled "modeled vs measured" where unconfigured.
- Emergency copy points to the user's declared region services — never geo-inferred.

## 8. Known limitations (must accompany any claim review)

- Self-reported injuries/symptoms are unverified user input.
- Clinician-documented fields are entered as structured data by the user — authenticity
  of the underlying clinical record is not verified.
- Only catalogued activities are evaluated; generic or unknown activity IDs are rejected.
- The `trunk_load` restriction contract is category-scoped (Q-TRUNK-01 open question —
  a 0.2 region-score activity is not caught by a categorical prohibition).
- Free-form `medicationActivityFlags` can trigger some rules (Q-MEDFLAG-01 — unvalidated
  user text as clinical signal).
- The app never measures vitals; it cannot detect an actual emergency — it only reacts
  to what the user reports.

## 9. Relevant screenshots (captured on staging build `ac3c60de`, Android emulator)

- Dashboard: weather card + restriction-aware suggestion ("upper-body cardio" for a
  non-weight-bearing ankle report) — Phase 21/22 device-validation artifacts.
- Safety report form: body part/laterality/type/weight-bearing/pain inputs.
- Post-injury dashboard: walking suppressed; suggestion remains non-weight-bearing.
- Pain-feedback sheet with escalation copy.
  (Stored under `~/.maestro/tests/` per run; the Phase 22 device-validation doc indexes them.)

## 10. Questions counsel is specifically asked to resolve

1. Does restriction-enforcement of this kind sit inside §520(o) CDS exclusions, or is it
   SaMD — given it is automated, non-HCP-facing, and partly opaque to independent review?
2. Does the consent-gated trainer `summary` surface change the CDS analysis
   (professional-facing but hides clinical categories)?
3. Is the urgent-symptom copy acceptable wellness triage-adjacent language, or does
   "contact local emergency services" constitute a regulated claim in either jurisdiction?
4. Any India-specific issues: DPDP consent for health-adjacent draft data, ABDM context
   if clinician-documented restrictions ever flow from Indian providers.

**Bottom line for counsel:** engineering posture is conservative — everything
medical-adjacent ships inert until reviewed. The review asks are the four questions above.

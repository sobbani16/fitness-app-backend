# Beta Readiness — Feature-Gate Matrix (Phase 21)

Engineering validation ≠ clinical approval. This matrix separates what can operate as **general wellness** (no unapproved clinical rules involved) from what must stay gated.

## Flag matrix by audience

| Flag | Internal eng | Clinical reviewer | Limited beta | Public prod |
|---|---|---|---|---|
| `weather_intelligence_v2` (env observation) | ✅ on | ✅ on | ✅ on — general wellness weather info | ✅ on |
| `activity_safety_engine` (evaluation endpoints) | ✅ on | ✅ on (for review) | ⚠️ off — verdicts use unreviewed rules | ❌ off |
| `health_aware_recommendations` (gated recs) | ✅ on | ✅ on | ❌ off | ❌ off |
| `activity_safety_shadow_mode` | ✅ on | optional | ❌ off | ❌ off |
| Trainer conflict flags | ✅ | ✅ | ⚠️ review UX needed | ❌ off |
| Urgent-symptom escalation | on everywhere it already exists — **safety-critical, not a feature** | | | ✅ always |

## Rationale per class

- **General wellness OK for beta**: weather display, activity catalog browse, generic exercise info, logging — none depend on clinical rules.
- **Beta-blocked**: anything emitting a restriction-aware *verdict* (BLOCK/MODIFY/review) to a real user — its correctness depends on DRAFT rules a clinician hasn't approved. Staging personas prove behavior; real users must not see it.
- **Always-on**: urgent-symptom emergency-routing copy — suppressing it would be less safe than showing it.
- **Mobile-flag-proof**: all clinical gating is **server-side** (`requireFeature` middleware). A mobile build cannot enable it — flag state lives in the backend env/registry.

## Intended-use wording (pending counsel — not a legal determination)

- No "diagnose/treat/prevent" language anywhere — `noMedicalClaims:true` is emitted on eval responses.
- Restriction copy reads "recorded restrictions" / "your safety profile" — never clinical directives.
- Emergency copy: "may require urgent attention" + region-appropriate number — no triage outcome claims.
- Claims inventory + suppression list: `docs/audits/activity-safety-claims-inventory.md`.

## Beta entry checklist

- [ ] `activity_safety_engine` OFF for beta cohort (server-side flag)
- [ ] weather_intelligence ON with honest unavailable states
- [ ] Urgent-escalation path reachable + tested on device
- [ ] Trainer `summary`-only detail verified (no clinical category leakage)
- [ ] Regulatory counsel sign-off on the claims inventory
- [ ] Clinical rules: 0/71 approved — keep sealed

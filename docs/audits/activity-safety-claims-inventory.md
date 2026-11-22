# Intended-Use & Claims Inventory (Phase 17 §10)

Working document for qualified regulatory/legal review (US + India). **Not a legal determination — uncertainty is flagged, not resolved.**

## Feature → claim class

| Feature | What it does | Probable class | Notes for counsel |
|---|---|---|---|
| Workout plans, catalog, logging | General fitness tracking | General wellness | Low risk |
| AI coach / meal suggestions | Education + general guidance | General wellness (per FDA GWP framework) | Keep language non-diagnostic |
| Nutrition trends, macro tracking | Education | General wellness | |
| **Activity-safety restriction enforcement** | Blocks/modifies activity per user-reported + clinician-documented restrictions | **Decision-support-adjacent — REVIEW REQUIRED** | Determines outputs based on health inputs; sits near CDS/Software-as-a-Medical-Device boundary. Key question: are recommendations "intended for the purpose of diagnosis/prevention/treatment" vs supporting general exercise safety? Independent basis + non-HCP-facing automation raises SaMD questions under FD&C Act §520(o) exceptions analysis |
| Urgent-symptom escalation copy | Directs to emergency services | Higher-risk wellness / triage-adjacent — REVIEW REQUIRED | Wording must avoid triage claims ("may require urgent attention" ✓ vs "you need emergency care" ✗) |
| Severe-weather/AQI deferrals | Environmental caution | General wellness | EPA/NWS/IMD sourced, disclosed |
| Trainer conflict flags | Professional-facing summary | Possibly clinician-facing CDS — REVIEW | §520(o) hinges partly on whether HCP can independently review basis — `summary` detail intentionally hides clinical categories which cuts AGAINST independent-review criterion; needs counsel |
| Wearable recovery overlay | Engagement | General wellness (reads, never overrides restrictions) | |

## Jurisdiction flags

- **US**: FDA General Wellness guidance + CDS guidance + §520(o) criteria. The safety engine's restriction-enforcement is the only component plausibly crossing into regulated territory — flag for formal review before enabling `health_aware_recommendations` broadly.
- **India**: CDSCO Medical Device Rules 2017 — software classification less settled; ABDM/telemedicine context matters if clinician-documented restrictions flow from Indian providers. Flag for local counsel.
- Privacy regimes (HIPAA-adjacent if covered-entity partners; India's DPDP Act) — separate review.

## Deliberate design choices that matter legally

- No diagnosis language anywhere (`noDiagnosis:true` in API).
- Clinical rules stay DRAFT + inactive — nothing medical reaches users until reviewed.
- Missing data → `INSUFFICIENT_DATA`, never "safe".
- Emergency copy uses declared region, never geo-inferred.

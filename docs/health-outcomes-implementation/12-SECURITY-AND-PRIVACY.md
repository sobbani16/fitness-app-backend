# 12 — Security & Privacy

**Status:** ENGINEERING_COMPLETE for implemented tables

## Controls
- All new routes user-scoped: `uid = req => req.userId || getUserId(req)` — identity never from body
- All new features behind server flags, `default:false`, `failOpen:false`
- Consent required before any health write (`consentAcknowledged: true` → timestamped server-side)
- Cross-user isolation covered by tests on every new route
- Deletion/export: `userMedication`, `clinicalMeasurement`, `userClinicalReview` added to accountData `OWNED`; `medication`, `clinicalRuleEvent` classified shared (catalog/audit)
- No PHI in logs: safety audit stores decision metadata, not values; medication notes/log copy contains no dose values
- AI providers receive no condition/medication/lab payloads

## Remaining
- ~30 pre-existing unclassified models in deletion coverage (predates this work — flagged for dedicated pass)
- Regulatory: health-data retention/ HIPAA-adjacent posture needs founder+legal review (documented in audit doc 11)

# Phase 22 — Controlled Beta Readiness

Extends `activity-safety-beta-readiness.md` (Phase 21 matrix) with the five-audience
release matrix, flag-enforcement verification, the legacy-path check, and a practical
beta checklist. Engineering validation ≠ clinical approval; nothing here authorizes release.

## Release matrix

| Capability | 1. Internal eng | 2. Clinical reviewer | 3. Limited wellness beta | 4. Clinical functionality | 5. Public release |
|---|---|---|---|---|---|
| Weather display (Open-Meteo/NWS/IMD) | ✅ | ✅ | ✅ general-wellness info | ✅ | ✅ |
| Activity catalog / generic exercise browse | ✅ | ✅ | ✅ | ✅ | ✅ |
| Onboarding draft persistence (Phase 22) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Injury/symptom self-report **collection** | ✅ | ✅ | ⚠️ collect-only, verdicts hidden | ✅ | ✅ |
| Safety **verdicts** to users (BLOCK/MODIFY/etc.) | ✅ | ✅ (review surface) | ❌ unapproved rules | ⚠️ only for rules with APPROVED status | ⚠️ approved rules only |
| `health_aware_recommendations` gated suggestion | ✅ | ✅ | ❌ | ⚠️ approved rules only | ⚠️ approved rules only |
| Trainer conflict flags | ✅ | ✅ | ⚠️ counsel + UX review | ⚠️ | ⚠️ |
| Urgent-symptom escalation copy | ✅ | ✅ | ✅ safety-critical, not a feature | ✅ | ✅ |
| Voice/coach surfaces w/ safety gate | ✅ | ✅ | ❌ | ⚠️ | ⚠️ |
| DRAFT clinical rules emitting to real users | ❌ never | ❌ | ❌ | ❌ | ❌ |

## Flag enforcement — verified Phase 22

- All safety surfaces are gated **server-side** via `requireFeature(...)` on every
  `/activity-safety/*` route (verified in `src/routes/activitySafety.js`: recommendation,
  evaluate, symptoms, injuries, feedback, profile — every verb).
- Flag resolution: env override `FF_*` > provider flags > registry default `false`
  (`featureFlags/service.js`). **No mobile/client path can enable a flag** —
  `GET /config/features` is read-only.
- Fail-closed evidence on staging: `aiCoach`/`trainerDiscovery`/voice were OFF for the
  test persona → gated UI absent (verified on-device Phase 22); env vars enabled them
  and the surfaces appeared after redeploy.
- **Production:** neither `FF_ACTIVITY_SAFETY_ENGINE` nor
  `FF_HEALTH_AWARE_RECOMMENDATIONS` exists in prod env — engine and gated
  recommendations are unreachable there (verified Phase 21).

## Disabling the engine does not reopen an unsafe path — verified

- With `health_aware_recommendations` OFF, `/activity-safety/recommendation` →
  `403 FEATURE_DISABLED`; the dashboard suggestion card simply does not render
  (mobile renders nothing — not a degraded suggestion).
- The pre-existing `/recommendations` route (nutrition-balance engine) can emit a
  `type:'workout'` token, but it **never consumed safety rules** — it is the current
  production surface, not a legacy safety path. Disabling the safety engine returns
  staging to today's production behavior; it does not *reactivate* anything the
  safety work had closed. No engineering change introduced a new ungated path.
- Cached advice remains `staleAt`-invalidated; notification send-time rechecks stay on
  (they are infrastructure, flag-independent — turning flags off only removes the
  endpoint, not the hygiene already applied to stored rows).

## Do not expose unreviewed rules

- DB CHECK constraint: APPROVED requires reviewedBy/reviewedAt/evidenceSourceId.
- Engine loads only APPROVED rows for user-facing evaluation; DRAFT rows are inert.
- Verified: staging DB currently 71/71 DRAFT; zero approved; no API path can activate.

## Practical beta checklist

**Before enabling for the beta cohort:**
- [ ] Server flag audit: `activity_safety_engine`, `health_aware_recommendations`,
      `trainer_*`, `aiCoach`, `voice_*` — confirm intended state per matrix row above.
- [ ] Confirm prod env has no safety flags (fail-closed stays true on deploy).
- [ ] Regression green: `activitySafety.*` suites + `ProfileForm`/onboarding tests.
- [ ] Clinical rule count on target env = expected DRAFT count (no APPROVED surprises).
- [ ] Device smoke on the beta build: login → dashboard renders, safety surfaces
      absent (beta config) or present (reviewer config) as intended.
- [ ] Onboarding kill test: fill partial → terminate → relaunch → draft restored.
- [ ] Account-switch test: A signs out → B signs in → B sees none of A's safety data.
- [ ] Counsel: claims handoff reviewed (`docs/regulatory/activity-safety-claims-handoff.md`).
- [ ] Clinical: assignment matrix owned by a real reviewer for all P1 rules.

**During beta:**
- [ ] Monitor `requiredData`/`INSUFFICIENT_DATA` rate — high rates mean missing
      signals, not missing safety.
- [ ] Urgent-escalation events logged + reviewed (safety-critical path exercised?).
- [ ] Injury PATCH 4xx rates — watch for client-version mismatches on new validation.

## Release authority

No release/submission is authorized by this document. Public enablement requires:
all P1 rules APPROVED by qualified reviewers + counsel sign-off + explicit owner go-ahead.

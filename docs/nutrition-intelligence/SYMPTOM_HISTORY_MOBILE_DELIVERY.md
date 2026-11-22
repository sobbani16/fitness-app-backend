# SYMPTOM_HISTORY_MOBILE_DELIVERY — DELIVERED (H4)

**Backend:** `GET /activity-safety/symptoms` added — owner-scoped (`userId`), newest-first, capped at 90/200, feature-gated `activity_safety_engine`; route test verifies scoping (18/18 pass).
**Mobile:** `SymptomHistoryScreen` — list with formatted codes + timestamps + severity/context, Alert-confirmed delete (invalidates safety recs), observational patterns card from `trends.symptoms` (non-causal copy), professional-review notice when backend signals, privacy notice ("not shared with trainers"), coverage line, loading/empty/error states. Entry point: "View symptom history" on SafetyReportScreen; gated `activitySafetyEngine` in RootNavigator.
**Gaps (honest):** no edit endpoint exists backend-side — delete+re-add is the current path; timeline = chronological list.
**Tests:** 3/3 component tests (renders/empty/error); typecheck clean; eslint clean.

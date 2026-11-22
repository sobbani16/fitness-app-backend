# SYMPTOM_CONTEXT_ENGINE — observational symptom/context intelligence (symctx-v1)

**Module:** `src/services/symptomContext.js` → consumed by `trends.js` → `GET /me/progress/unified`. Reuses existing `UserSymptomReport` (symptoms/severity/context/persistence/status/reportedAt), `FoodLog`, `WorkoutSession`, `SleepLog` — no new tables, no new write paths.

**Output:** per-report `priorMeals` (logged 0–6h before the report), `workoutAdjacent`; `associations` = food-token co-occurrence ≥2 days within window, each carrying coOccurrenceDays/foodLoggedDays/symptomReportDays + non-causal note ("co-occurrence does not establish that X caused the symptoms"); `escalation` when ≥2 reports marked persistent/worsening → `professional_review_suggested`.

**Boundaries enforced:** no diagnosis, no elimination advice, no causal claims; association basis labeled `temporal_cooccurrence_within_6h`; report rows are the user's own records (deletion exists via activity-safety DELETE endpoints).

**Unlocks (engineering-verified; clinical framing pending):** H01–H07/D02/E04/G04 class — symptom×food/sleep/activity associations exist + surfaced; specific per-scenario verbatim checks remain in fixture review.

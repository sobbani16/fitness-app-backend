# 10 — User Outcomes & Metrics

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22

## 1. Behavioral measures (available today)

| Measure | Source | Status |
|---|---|---|
| Meal logging consistency | FoodLog + DailyProgressDay + streaks | WORKS |
| Activity minutes / steps | DailySteps, HealthEnergyRecord, WorkoutSession | WORKS |
| Resistance training frequency | WorkoutSession/ExerciseSet | WORKS |
| Sleep duration/regularity | SleepLog | WORKS (regularity not scored) |
| Fiber intake | fiberIntelligence feature (flag) | WORKS (gated) |
| Adherence to plan | DietAdherenceScore, weekly adherenceEngine | WORKS |
| Water intake | WaterLog | WORKS |
| Habits | Habit/HabitCompletion | WORKS |

## 2. Physiological/clinical measures (gap)

| Measure | Status |
|---|---|
| Weight | WORKS (WeightEntry, explicit-entry API) |
| Waist circumference | MISSING |
| Blood pressure | MISSING |
| HbA1c / fasting glucose | MISSING |
| Lipids (LDL, HDL, TG, non-HDL) | MISSING |
| ALT/AST, GGT (liver) | MISSING |
| eGFR/creatinine (CKD) | MISSING |
| Uric acid (gout) | MISSING |
| TSH (thyroid) | MISSING |
| Strength/functional tests | Partial — ExerciseSet records allow derived estimates; no standardized tests |
| Validated pain/sleep/mood scores | MISSING |
| Clinician-provided assessments | BaselineAssessment exists — **trainer-scoped only**, not clinical |

## 3. Outcome models present

- `OutcomePlan`/`OutcomeGoal`/`OutcomePlanAdjustment` — versioned, trainer+member agreement, `progressSource` enum includes self_report/workout_records/weight_trends/check_ins/habit_completions/trainer_assessment. **Scope: paid coaching relationships.** This is a solid reusable pattern but not the consumer health-outcomes system the product needs.

## 4. Progress-interpretation requirements (Phase 6.4) — current posture

| Requirement | Today |
|---|---|
| Observed vs clinically-meaningful change | No MCID thresholds anywhere |
| Measurement uncertainty | `quality`/`synthetic`/`sufficiency` fields exist on measurement/summary models |
| Confounders (medication change) | Not modeled |
| Verified remission criteria | Not modeled |
| "Never declare cured" | No code path currently declares clinical improvement — safe baseline |

## 5. 90-day journey feasibility today

- Baseline (Days 0–7): profile+goal+allergies+injuries+prefs collectable; **conditions, meds, labs not collectable**.
- Consistency (8–30): habits/logs/activity nudges exist (todayActions, reminders).
- Adapt (31–60): weeklyReview + calorieAdjustmentEngine exist (guarded).
- Evaluate (61–90): **no clinical follow-up measurement to compare** — only weight/steps/logs.
- Sharing cards: no progress-card feature exists; analytics events infra exists.

## 6. Verdict

Behavior tracking is the most production-ready dimension (8/8 measures work). Clinical outcome measurement is the largest gap — the platform can currently only evidence *behavior change + weight*, not *health outcomes*.

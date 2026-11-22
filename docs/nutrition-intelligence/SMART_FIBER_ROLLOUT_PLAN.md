# Smart Fiber Rollout Plan (owner authorization required per stage)

| Stage | Flag | Beta eligible? | Verified | Kill group |
|---|---|---|---|---|
| 1 | `fiber_intelligence_enabled` (parent) | **YES** — prerequisite | 403/404 fail-closed | manual |
| 2 | `fiber_daily_goal_enabled` | **YES** — totals + default-basis target | live 200, honest "no inputs" | manual |
| 3 | `fiber_meal_sequencing_enabled` | **YES** — food-based ordering education | gate-verified | manual |
| 4 | `fiber_reminders_enabled` | Conditional — double-checks flag at send time | gate-verified | manual |
| 5 | `fiber_supplement_suggestions_enabled` | **NO — medical group** | label-only, suppressed outcomes audited | medical |
| 6 | `fiber_ai_enabled` | **NO — ai group, needs review** | — | ai kill |
| 7 | `fiber_voice_enabled` | **NO — ai group** | — | ai kill |

Recommended order: enable 1+2 for beta cohort → observe unknown-data rendering → then 3 → 4 last (notification surface). Stages 5–7 stay OFF regardless until professional review.
Rollback: single flag off instantly removes the whole mount (parent) or the sub-surface.

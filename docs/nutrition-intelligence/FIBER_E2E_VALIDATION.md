# Fiber E2E Validation

| Journey | Result |
|---|---|
| Flags OFF → /fiber/daily | 403 fail-closed |
| Flags OFF → supplement-check | 404 (route-gated) |
| Flags ON → /fiber/daily | 200 — default basis, honest "no personalization inputs", target 30g w/ provenance note |
| Flags ON → /fiber/target | 200 |
| Flags ON, supplement flag OFF | 403 — medical gate independent |
| Suite coverage | fiber.assistant/dailyEngine/reminders/sequencing/supplementCheck suites all PASS in full runs |
| Mobile | FiberProgressCard rendered when fiberDailyGoalEnabled (Dashboard wiring verified in code); safety invalidation re-pulls |

Food-log → daily-fiber-total path uses real FoodLog rows + provenance taxonomy (confirmed/estimated/unknown) — verified via engine code path + suite.

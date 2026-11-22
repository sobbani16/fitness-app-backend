# Smart Fiber Intelligence Audit

## Architecture (owner-landed, verified)
`src/services/fiber/{targets,dailyEngine,sequencing,suggestions,supplementCheck,assistant,weeklyReview}.js` + `src/routes/fiber.js` + models `FiberDailyRecommendation` (cache/audit w/ inputsHash staleness) + `FiberSupplementCheck` (persisted incl. suppressed outcomes).

## Verified behaviors
- **Taxonomy:** per-log confirmed/estimated/unknown — `fiberG NULL` or provenance-flagged → unknown, never coerced to 0; estimated sources (ai_estimate/external) split out.
- **Target provenance:** `fiberTargetBasis` (formula|custom|clinician|default) + note; new user with no inputs → `basis:'default'` with honest reference note — no fabricated personalization.
- **Supplement pathway (medical gate):** label-derived fiber only (`labelFacts`), no invented dose, education copy = label-directed language, suppressed_safety/unverified outcomes persisted for clinical review, fluid-restriction/pregnancy pattern gates present.
- **Flags:** parent `fiber_intelligence_enabled` gate at router mount; per-endpoint child flags; supplement path `group:'medical'`; AI/voice in `group:'ai'` kill group; reminders re-check flag at send time + suppress.
- **Soluble/insoluble:** not computed — total fiber only (correct: source data lacks fractionation).
- **Raw/cooked:** `preparationType` enum respected; no silent conversion.

## Live API check (fitness_test)
flags OFF → `/fiber/daily` 403, supplement 404 (route-gated). Flags ON → `/fiber/daily` 200 returning `basis:'default'` + `reviewRequired:false` honest response; supplement still 403 (separate flag). Fail-closed confirmed.

## Boundary assessment
Education vs medical split is clean: target is a reference value w/ provenance; supplement path is the only medical gate and stays OFF. No GI/diabetes/pregnancy/kidney-specific targets observed outside the suppression lists.

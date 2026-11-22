# OUTCOME_DIVERGENCE_VALIDATION

**Consumer:** `detectOutcomeDivergence` now wired in `trends.js` — `recentScores` from real `DailyScoreSnapshot` rows (14-day desc) vs `goalProgress` (smoothed-weight direction vs canonical goal expectation). `outcomeReview` → `reviews[]` entry `score_outcome_divergence` on `/me/progress/unified`.

**Verified:** test 'divergence: high scores + stalled → outcome_review' green; insufficient inputs → `no_data` (never a false divergence claim). Weight unchanged ≠ poor adherence — `stalled` only when direction flat vs directional goal; `drifting` for stable goals.

**Scenario status (engineering):** A09/L03/L04/L05 — trend inputs now exist (weight smoothing, goal direction, score snapshots, logging coverage). Verbatim fixture assertions unchanged; integration evidence recorded here.

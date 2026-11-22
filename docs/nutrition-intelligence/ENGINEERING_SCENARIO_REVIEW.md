# Engineering Scenario Review Mechanism

`data/scenarioReviewDecisions.json` — append-only, hash-chained decision log (each record links prevHash).
`scripts/submit-scenario-review.js <ID> approve|reject "<justification>"` — requires `SCENARIO_REVIEWER=<identity>` env; rejects bad ids, missing identity, justification <10 chars. Identity is recorded, never invented.

Generator wiring (`scenario-matrix.js`): the seven pending scenarios have `API_EVIDENCE` entries citing `tests/asyncScenarios.api.test.js`. A scenario is promoted to `executed_pass` **only** when a matching `approve` decision exists — otherwise it stays `blocked_not_implemented`. Matrix today: **72/120** (mechanism verified, zero decisions recorded).

Reviewer checklist per scenario: read `expectedVerbatim` in `data/scenarioFixtures.json`, re-run the cited test file, confirm behavior = expectation, then sign via the script. These 7 are non-clinical engineering behaviors — an authorized engineering reviewer suffices; no clinician needed.

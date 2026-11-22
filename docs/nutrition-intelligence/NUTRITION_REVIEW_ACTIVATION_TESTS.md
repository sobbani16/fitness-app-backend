# Nutrition Review Activation — E2E Results (real route + fitness_test)

Synthetic pending fixture → `POST /decision APPROVE` (SUPER_ADMIN user) → consumer query `verifiedAt:{not:null}` visible=1 → `POST /revoke` → visible=0 → ordinary member attempt → **403** → synthetic fixture + audit rows cleaned; all 40 batch profiles preserved unverified.

Unit suite `tests/nutritionReview.test.js` 8/8: list+identity, 401/403, APPROVE sets verifiedAt + audits, REJECT/REQUEST_CHANGES never verify, justification validation, double-approve & concurrent 409, revoke guard + member 403.

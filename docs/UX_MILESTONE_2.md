# Milestone 2: label review and meal integrity

October 16, 2026. Local implementation only; not deployed.

- Required label nutrients reject missing/invalid inputs; optional fiber/sugar/sodium remain null.
- Unknown OCR mass no longer defaults to 100 g. Extraction does not infer volume density or fill unknown nutrients with zero.
- Label save accepts a stable client ID and atomically creates the FoodLog and ScannedLabel. Concurrent deliveries return the same account-owned record. Deleted diary entries are not resurrected by retry.
- Food logs preserve unknown fiber; mobile meal upload/hydration was updated with this contract.
- Label route input limits and generic retryable server errors avoid returning internal database details.

Deploy migration `20261016160000_unknown_label_nutrients` and regenerate/deploy the Prisma client before distributing the new mobile UI. Historical zero values remain unchanged. Existing clients that omit stable scan IDs remain compatible but do not gain retry deduplication. Keep a nullable-compatible backend during rollback once null values exist.

Local validation: all 20 migrations applied successfully to the new `fitness_ux_m2_20261016` PostgreSQL database. `scripts/test-label-integrity.js` refuses non-local or non-`fitness_ux_m2_` database names and removes only its own fixtures. It verifies eight concurrent deliveries produce one meal, account isolation, rollback on a failed label insert, null round-trip, and non-resurrection after deletion.

Run the normal Jest suite, then with DATABASE_URL explicitly pointing to a disposable migrated local database run `node scripts/test-label-integrity.js`. The final result was 256 Jest tests in 28 suites plus all five database integrity checks passing. Live service, signed-device and public-release acceptance are separate.

Full UX details, mobile tests and remaining limitations are recorded in fitness-app-mobile/docs/UX_MILESTONE_2.md. No deployment, production data changes or TestFlight build was performed.

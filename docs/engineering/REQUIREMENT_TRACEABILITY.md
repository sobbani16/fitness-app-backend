# Requirement Traceability (HUM-P6-018) — integration slice

| req | implementation evidence | test evidence | status |
|-----|------------------------|---------------|--------|
| HUM-P6-013 contract surface machine-readable | `contracts/api-contract.json` + `scripts/emit-api-contract.js` @ `155d341` | drift guard test 3/3 | implemented-unmerged |
| HUM-P6-013 backcompat additive-not-breaking | `scripts/check-contract-additivity.js` @ `3c1881f` | fixture tests green | implemented-unmerged |
| HUM-P6-013 old-mobile both directions | minClientContract 426 runtime path | apiContract.test.js 426 case | verified on branch |
| HUM-P6-013 release-order deps | documented in INTEGRATION_CHECKPOINT | n/a | partial — deep shapes pending |
| HUM-P6-018 canonical ledgers | this docs/engineering/ set @ this branch | n/a | implemented — first iteration |
| release-mechanics migration validation | `check-migrations.js` | fixture tests; 69/69 real scan | implemented-unmerged |
| release-mechanics expected-head guard | `check-release-head.js` | fixture tests incl. mismatch detection | implemented-unmerged |
| release-mechanics deployment safeguards | railway.json inspection; merge=release-op policy | unverified — needs Railway access | partial-blocked |

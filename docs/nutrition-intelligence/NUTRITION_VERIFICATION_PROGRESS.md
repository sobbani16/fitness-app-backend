# Nutrition Verification Progress

| Scope | Total | fdc-linked | Verified profile | Preview-eligible |
|---|---|---|---|---|
| dev `fitness_app` | 430 | 186 | 11 | 175 (dev-keyed) |
| `fitness_test` | 41 | 40 | 0 | **40 → manifest built** |

- Preview adds source-backed USDA values (`verifiedAt NULL` — source-backed ≠ human-verified; never renders as verified).
- Missing nutrients preserved as absence (null), never coerced 0; added sugar never inferred.

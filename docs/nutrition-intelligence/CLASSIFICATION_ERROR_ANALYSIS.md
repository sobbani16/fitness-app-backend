# CLASSIFICATION_ERROR_ANALYSIS

| Defect | Root cause | Fix | Verified |
|---|---|---|---|
| Nuts → cooking_fat+legumes | fat≥45 & fiber+protein bands lacked discriminators | cooking_fat requires ~0 protein/fiber; legumes fat≤2+pro≥10 | ✓ unit test |
| Rye bread → legumes_soy | same | same fix | ✓ audit |
| Honey → unlabeled | no added_sugar hint | hint added | ✓ audit |
| whole-wheat unlabeled | regex missed hyphen | `whole[-\s]?wheat` | ✓ audit |
| 67% UNKNOWN | only 18/420 verified profiles | data coverage, not classifier | documented |

Precision/recall: no human-reviewed labeled reference set exists → per policy, coverage + resolved-ambiguity reported instead of invented accuracy %.

# Fiber Intelligence — Evidence Register

Every user-facing claim the system makes, the basis it rests on, and how it is
hedged. Rule versions: `fiber-target-v1`, `fiber-daily-v1`, `fiber-sequence-v1`,
`fiber-supplement-check-v1`.

## Daily fiber target

| Claim | Basis | How it's used |
|---|---|---|
| Adults: ~14 g dietary fiber per 1,000 kcal | IOM/NASEM DRI & Dietary Guidelines basis (widely used derivation: 14 g/1,000 kcal) | `formula_adult` when a calorie target exists |
| Minors (1–18): fixed AI values 19–38 g by age/sex | IOM Adequate Intake table | `reference_minor`; adult formula NEVER applied |
| Pregnancy 28 g, lactation 29 g | IOM AI for life stage | `reference_life_stage` |
| Adult AI fallback 25 g F / 38 g M (19–50), 21 g F / 30 g M (51+) | IOM AI | `reference_adult_ai` when no calorie target |
| Restricted-GI conditions → conservative reference + clinician review | Deliberately conservative product rule, NOT a clinical value | `restricted_reference`, `reviewRequired: true`; surfaced as "clinician review advised" |
| Clinician/custom overrides kept verbatim | User/clinician input with provenance | `clinician` / `custom` basis |

## Confirmed vs estimated vs unknown

| Rule | Basis |
|---|---|
| Only measured/declared fiber counts toward `confirmedG` | `fiberStateOf`: snapshot `nutrientUnknowns` + `loggedSource` estimate markers |
| NULL `fiberG` = unknown, never 0 | Existing `nutrientCompleteness` contract |
| `fiberRemaining = max(0, target − confirmed)` | Spec formula; estimated/planned/supplement tracked separately |

## Meal sequencing

| Claim | Basis | Hedge in copy |
|---|---|---|
| Vegetables/protein before starch is associated with lower post-meal glucose in some studies | Crossover meal-ordering studies (e.g. Weill Cornell 2015; Shukla et al.; similar Japanese trials) — small, context-dependent | "reasonable default order", "does not guarantee any glucose outcome", "optional suggestion, not a prescription" |
| Non-starchy vegetables get the first slot; fruit/legumes/nuts rank after protein | Sequencing evidence covers vegetable-first specifically; other fiber sources are contextual | Roles labeled honestly; fruit is never called a vegetable |
| Mixed dishes (biryani, khichdi, pizza, sandwich) get NO forced order | Components can't realistically be separated | `separable: false` with explanation |
| Low-fiber separable meals may get an optional addition suggestion | Fiber-first product principle | "Optionally"/"Consider" phrasing, allergy/dislike filtered |

## Supplement (psyllium) safety & label

| Claim | Source | How it's used |
|---|---|---|
| Take with adequate liquid, commonly ≥240 mL (8 fl oz) per dose; never dry | MedlinePlus drug info (a601104) + product labels | Fixed direction line in every check |
| Swallowing/obstruction risk without liquid | MedlinePlus | `swallowing_risk`, `gi_obstruction`, `gi_stricture` → suppress |
| Medication absorption timing — separate per label (commonly hours) | MedlinePlus | `medications_not_evaluated` info + spacing guidance |
| Pediatric use is clinician-directed (labels commonly 12+) | OTC label convention | `under_12` → suppress; `minor` → warn |
| Pregnancy → confirm with clinician | Conservative product rule | `eligible_with_warnings` |
| No published interaction rule = NOT EVALUATED, not "safe" | supplement safety engine invariant | reported as info, never as reassurance |
| Fiber per serving only from a verified product label | `SupplementProduct.verificationStatus` + `labelFacts` | else `suppressed_unverified`; no tsp→g conversion |

Sources explicitly referenced: MedlinePlus psyllium
(https://medlineplus.gov/druginfo/meds/a601104.html, checked 2026-11-18);
IOM/DGA fiber references (standard dietary reference values).

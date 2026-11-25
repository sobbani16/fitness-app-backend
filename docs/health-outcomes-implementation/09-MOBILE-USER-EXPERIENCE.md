# 09 — Mobile User Experience

**Status:** ENGINEERING_COMPLETE

## Screens (all behind fail-closed flags)
| Screen | Flag | Flow |
|---|---|---|
| `HealthConditionsScreen` | `healthConditions` | search catalog → pick → source (self-reported/clinician-diagnosed) → consent → save; list/remove |
| `MedicationsScreen` | `userMedications` | add name+dose → consent → classified/unclassified badge, stale-confirm, remove |
| `MeasurementsScreen` | `clinicalMeasurements` | metric chips → value(+diastolic)/unit/date/source → consent → save; history w/ correct (supersede) + remove |

- API clients: `api/healthConditions.ts`, `medications.ts`, `clinicalMeasurements.ts`
- Registered: RootNavigator param list + `gateScreen` + `Stack.Screen`; entry rows on SummaryScreen (each `isEnabled`-gated)
- Design system only (`Card/Copy/Action/Field/Segmented/ListRow/Notice/Skeleton/Chip`); loading/empty/error states; a11y roles/labels
- Required disclaimers rendered verbatim (medication non-prescribing notice, measurement non-interpretation, condition consent copy)

## Verify
`npx tsc --noEmit` → clean · eslint on new files → clean · FeatureFlagsContext tests → 8 pass

## Not done (P1)
90-day journey screens, trends/charts, outcome dashboards — documented next phase

# Stage 4 — AI Coach + Hey Leo Fiber Intelligence

Status: **CONDITIONAL PASS (development only)** — deterministic fiber answers
verified end-to-end over HTTP (chat + voice) and on iOS simulator UI.
Android device verification not executed (same host/APK constraints as Stages 1–3).
Nothing enabled in production; `fiber_supplement_suggestions_enabled` remains OFF.

## Commits

| Repo | Commit | Contents |
|---|---|---|
| backend | `2565642` | env guards on AI-group fiber flags; assistant weekly + mixed-dish + article-stripping + fiber-thread context; voice interrogative remap; chat fiber-thread map; tests |
| mobile | `6dbf596` | ASK_FIBER preview/result UX, undo hidden for answer-only commands, `createdEntities` typing; `maestro/fiber-stage4-verify.yaml` |

Prior: backend `7d35500` (Stage 3), mobile `20fef22` (Stage 3).

## Actual flag values (dev `.env`, gitignored)

```
FF_AI_COACH=true
FF_VOICE_FOOD_LOGGING=true
FF_FIBER_AI_ENABLED=true
FF_FIBER_VOICE_ENABLED=true
```

`fiber_supplement_suggestions_enabled` — OFF (unchanged).
`ai_emergency_shutdown` — OFF.

**Environment restrictions (structural):** `environments: ['development','test']`
added to both `fiber_ai_enabled` and `fiber_voice_enabled` this stage.
Verified: `NODE_ENV=production` + `FF_FIBER_AI_ENABLED=true` → resolves `false`.
All four Stage-1..3 fiber flags carry the same guard. Dependencies verified:
`fiber_ai` needs `fiber_intelligence` + `ai_coach`; `fiber_voice` needs
`fiber_intelligence` + `voice_food_logging` — both parents enabled dev-only.

Live `/config/features` (authenticated probe user on :4000):
`aiCoach: true, fiberAiEnabled: true, voiceFoodLogging: true, fiberVoiceEnabled: true`.

## Spec question coverage (all verified live)

| Question | Path | Result |
|---|---|---|
| How much fiber have I eaten today? | daily engine | "You've confirmed 77.7 g… target 37 g… 5 logged items have no fiber data… Target reached." |
| How much fiber do I still need? | daily engine | honest remaining/`mealsLogged=0` copy |
| Which food should I eat first? | sequencing engine | last logged components or honest "scan a meal first" |
| Does dal contain fiber? | ingredient catalog | 10.7–17 g **per 100 g dry**, cooked-portion caveat, never a cooked-looking number |
| What can I add to chicken and rice? | suggestions (fiber thread) | food-first picks, or "on track" when gap closed |
| Is quinoa a good fiber source? | catalog | "Quinoa, cooked has about 2.8 g per 100 g…" (article-stripping fix) |
| Why isn't biryani separated? | mixed-dish explainer | "mixed dish — no honest eat-this-part-first" |
| What to eat tomorrow? | suggestions | gap-aware food picks |
| How was my fiber this week? | `weeklyReview` | 7-day headline + pattern suggestion |
| Can I take isabgol? | supplement education | hydration rules + label-check pointer, **no dose** |

## Grounding & safety

- Every fiber answer is assembled server-side from `dailyFiber`, `sequenceMeal`,
  `weeklyReview`, `ingredientCatalog`, or `supplementCheck.EDUCATION` — the LLM
  never sees fiber questions (`groundFiberAnswer` intercepts before `generateReply`).
- Unknown stays unknown (5 unknown items reported as "no fiber data", not 0 g).
- Dry-basis values report the range with the dry qualifier — never extrapolated.
- No supplement dose, product instruction, or "fiber first prevents spikes" claim
  anywhere in the answer set (asserted in tests + UI scan).
- Voice executes the identical `groundFiberAnswer` path — same numbers as chat
  (verified: both surfaces returned the same daily answer text).
- Flag re-checked at voice execute time; ASK_FIBER creates **zero entities**
  (`createdEntities: []`) and is undo-exempt.
- Per-user fiber thread (10-min in-memory marker) enables keyword-free
  follow-ups ("What can I add to dinner?") while staying strictly user-scoped —
  no cross-user data path exists.

## Bugs found & fixed this stage

1. **Voice mis-routing**: interrogative fiber transcripts ("how much fiber have
   I had") parsed to `LOG_FOOD` before the ASK_FIBER remap — a question could
   have been written as a food log. Now any question-shaped fiber segment
   remaps to ASK_FIBER (non-question "log 200 g oatmeal" verified unchanged).
2. **Article capture**: "Is quinoa a good fiber source?" captured "quinoa a"
   → catalog miss. `foodPhrase` now strips articles/possessives.
3. **Missing weekly route**: "how was my week" fell through to daily totals.
   New `weekly_fiber` topic wired to `weeklyReview`.
4. **Named mixed dishes**: "why isn't biryani separated" needed no log lookup —
   `mixedDishIn()` explains the mixed-dish rule directly.
5. **Mobile undo hazard**: Undo button shown after answer-only voice commands —
   now hidden when `createdEntities` is empty (was a no-op server-side anyway).

## Tests executed

- `tests/fiber.assistant.test.js` — **23/23** (6 new: weekly, named mixed
  dishes ×3, article-stripping, thread follow-ups, supplement-in-thread, missing user)
- `tests/fiber.routes.test.js` + `fiber.e2e` + `featureFlags` + `voice` + `voiceParser` + `activitySafety.voice` — **100/100**
- Mobile component suites — **105/105**, `tsc --noEmit` clean

## Device evidence (iOS)

iPhone 17 Pro (iOS 26.4), dev app, signed-in user, backend :4000:

- `maestro/fiber-stage4-verify.yaml` — Leo tab (flag-gated) → scroll →
  "How much fiber have I eaten today?" → **grounded answer on device**:
  `"You've confirmed 77.7 g of fiber so far. Today's target is 37 g. 5 logged
  items have no fiber data — actual intake may be higher. Target reached."`
- Follow-up "What can I add to dinner?" (no fiber keyword) → fiber-thread
  routed → `"You're on track — no fiber gap right now. Keep vegetables,
  legumes, and whole grains in the rotation."` — no fabricated gap.
- No supplement/dosing surface visible.
- Screenshots: `~/.maestro/tests/2026-11-22_161922/fiber-stage4-verify/`
  (`fiber-daily-answer.png` — the money shot, `leo-open.png`,
  `step-019-…Food_options.png` showing the on-track follow-up reply).

Flow quirks discovered (documented for reruns): keyboard can't `hideKeyboard`
on iOS — a `scroll` dismisses it; the chat Field's a11y label merges
label+placeholder (match `.*For example.*`); button label is "Send question"
beneath the "Ask Leo" card heading.

## Performance

- Grounded `/chat` answer: ~10–40 ms (engine-only path, no LLM call).
- Voice `interpret` → `execute` ASK_FIBER: identical engine cost; execute
  verified `createdEntities: []`.
- Flag evaluation: env-provider, cached 60 s.

## Rollback verification

- `FF_FIBER_AI_ENABLED=false` / `FF_FIBER_VOICE_ENABLED=false` + restart →
  chat falls through to generic Leo; voice ASK_FIBER results `skipped` —
  **ordinary fiber tracking (/fiber/*, reminders) unaffected** (different flags).
- `ai_emergency_shutdown=true` → all group:ai flags false regardless.
- `FF_AI_COACH=false` alone → whole Leo surface gated; fiber dashboards remain.

## Known blockers

- **Android**: still blocked (stale staging APK documented in Stages 1–3;
  emulator instability on this host). Flow is reusable for a dev APK.
- **Voice on device**: microphone/voice journey not exercised on simulator
  (VoiceInput requires mic permission + audio capture; ASK_FIBER verified
  end-to-end over HTTP instead).
- **PostHog**: still unconfigured — env provider only; per-account targeting
  remains a pre-production prerequisite.
- Physical devices: none attached; simulators only.

## Recommendation — CONDITIONAL PASS

Stage 4 meets its objective in development: deterministic, safety-gated fiber
answers in Leo chat and Hey Leo voice, with conversation follow-ups, no
fabrication, no supplement bypass, and real iOS evidence. Conditions:
(1) rerun on Android with a current dev APK; (2) exercise mic-permission voice
path on a physical device; (3) PostHog targeting before any shared deployment.

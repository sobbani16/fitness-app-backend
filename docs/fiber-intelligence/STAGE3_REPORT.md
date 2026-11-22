# Stage 3 — Smart Fiber Reminders: Completion Report

Scope: `fiber_reminders_enabled`, **development/test only**, internal testing.
Baseline: backend `e5eb0c9` (Stage 2 live), mobile `43521e3`.

## 1. Flag state & environment scope

| Flag | Dev `.env` | Dev resolves | Prod resolves |
|---|---|---|---|
| `fiber_intelligence_enabled` | true | ✅ | ❌ (env guard) |
| `fiber_daily_goal_enabled` | true | ✅ | ❌ (env guard) |
| `fiber_meal_sequencing_enabled` | true | ✅ | ❌ (env guard) |
| `fiber_reminders_enabled` | true | ✅ | ❌ (env guard added this stage) |
| `fiber_supplement_suggestions_enabled` | — | false | false |
| `fiber_ai_enabled` / `fiber_voice_enabled` | — | false | false |

- `environments: ['development','test']` added to `fiber_reminders_enabled`. Verified live: `NODE_ENV=production` + `FF_FIBER_REMINDERS_ENABLED=true` → resolves **false**.
- Dependency chain: reminders → daily-goal → intelligence; parent-off cascades.
- Supplement suggestions OFF throughout; nothing in this stage touches them.

## 2. What was built

The reminder scheduler already had a flag-gated `fiber` category (user-picked clock times, send-time engine re-eval, dedupe, quiet hours, daily cap, priority floor). Stage 3 adds the context-aware layer the spec asked for:

**`times: ['auto']` smart timing** (fiber-only sentinel, validated in `preferences.js` — rejected for all other categories). `candidates()` derives windows from the user's own meal-reminder times (defaults when unset):

| Window | Derived time | Send-time rules |
|---|---|---|
| `morning` | breakfast time +30m (def 08:30) | Planning copy only; never a deficit claim |
| `midday` | lunch −30m (def 12:30) | Suppress if 0 logs (`too_early_no_logs`), `completeness:'low'` (`incomplete_data`), or gap closed |
| `pre_dinner` | dinner −75m (def 17:45) | Suppress on `incomplete_data`; else food-first gap suggestion |
| `evening` | dinner +90m, capped 21:00 (def 20:30) | Nonjudgmental summary; congratulatory if goal met; never "eat now" |
| `weekly` | Sunday at evening slot | 7-day review headline + one sustainable food swap |

**Send-time guards (all kinds):** after 21:30 local → `late_evening`; clinician-guided `reviewRequired` target → gap nudges suppressed (`restricted_target`), morning/evening get neutral copy with no food picks and no gap framing. Gap-closed suppression (`already_completed`) applies to gap-driven kinds only.

**Dedupe keys** `userId|fiber|dateKey|auto:{kind}` — idempotent re-planning; the weekly key lands only on Sundays. Planning tolerates a tick up to 60 min late so a coarse cron still produces the instance; send-time rules decide usefulness.

**Delivery:** fiber check-ins are server-evaluated `Notification` inbox records (ReminderInboxScreen) — there is **no OS lock-screen path** for fiber reminders, so sensitive totals can't surface on a locked device. If an OS push path is added later it must gate body detail on a user privacy control.

## 3. Live verification (dev DB, test user `fl-device-verify@syn.local`)

- `PUT /reminders/categories/fiber {"times":["auto"],"enabled":true}` → persisted; same payload on `water` → `'auto' timing is only valid for the fiber category`.
- planUser across the four daily windows → 1 instance each, correct kinds + dedupe keys.
- runTick at midday → **morning instance sent**: `"Today's fiber goal is 37 g. A fiber-rich side at one meal is usually all it takes."` (planning copy, no deficit claim).
- midday + pre_dinner instances → **suppressed `already_completed`**: the user had ~64 g confirmed vs 37 g target — a closed gap correctly produces no nudge.
- Sunday tick → evening + weekly instances planned (fire at their real slots).
- Re-plan ×3 → 0 new instances (dedupe stable); `masterEnabled=false` → 0 planned.

## 4. Tests

- `tests/fiber.reminders.test.js`: **25/25** — 11 new cases covering auto-window planning (kind payloads, meal-time derivation, Sunday-only weekly), `too_early_no_logs`, `incomplete_data`, `restricted_target`, `late_evening`, nonjudgmental evening copy, weekly headline body, 'auto' + HH:MM coexistence.
- Reminder + fiber regression: **154/154** across 8 suites.
- Mobile `tsc --noEmit` clean; `reminderPlan` suite 25/25.

## 5. Copy contract (verified)

- Never mentions supplements/psyllium — food-first only.
- Precise grams only from confirmed logs + catalog-backed suggestion servings (`~` estimated).
- Unknown fiber never read as zero — `incomplete_data` suppression when coverage is mostly unknown.
- No late-night compensation nudge — `late_evening` after 21:30; evening copy explicitly says "no catching up needed tonight".

## 6. Personalization & controls verified

- Allergens/avoid-lists filter suggestion picks (engine `allergenTerms`/`avoidNames`).
- Clinician-guided targets suppress gap nudges + picks entirely.
- Opt-in: master switch + per-category toggle; `masterEnabled=false` → zero planning.
- Quiet hours, daily cap, cooldown, sleeping/workout suppression — existing `decisionEngine` gates, all still apply.
- Timezone: `FOLLOW_DEVICE`/`FIXED_TIMEZONE` + `reconcile()` reschedules wall-clock instances on travel.
- Windows follow the user's own meal-reminder times when set.

## 7. Device evidence

- **iOS** (iPhone 17 Pro sim, iOS 26.4): `maestro/fiber-stage3-verify.yaml` **PASSED** — Account → Smart reminders → "Fiber check-ins" card + "Smart timing" toggle asserted, screenshot `fiber-reminder-settings.png` captured, no supplement UI.
- **Android**: `emulator-5554` attached, but the installed APK is the Phase-23 **staging** build (embeds a dead staging URL) → ANR on launch, can't sign in. A dev APK build was not attempted — host already resource-constrained. Flow committed; runnable against a dev build on a stable host.
- **Physical devices**: none attached — sims/emulator only, as in Stages 1–2.

## 8. Performance (live user, dev DB)

- `planUser`: ~105 ms cold, **9–10 ms** warm; `runTick`: **7 ms**.
- Fixed query set per tick (prefs + bounded context batch + engine re-eval); no N+1.
- Duplicate rate: 0 across repeated plans. Pending-instance leak: none — flag-off suppresses at both plan and send.

## 9. Rollback verification

- `FF_FIBER_REMINDERS_ENABLED=false` + restart → settings filtered at plan (no new instances) and pending fiber instances suppress `feature_disabled` at send (unit-verified).
- Category toggle off → setting disabled → candidates skip.
- Parent flag off → reminders cascade off.
- Production cannot resolve the flag (env guard).
- Inbox-only delivery → nothing pending on devices to cancel.

## 10. Verdict: **CONDITIONAL PASS**

Reminders are live dev-only with verified planning, send-time safety rules, honest copy, and working opt-out/rollback — iOS visually confirmed. Conditions: Android dev-build run still owed; physical devices unverified. **Stage 4 (AI/voice) not started; awaits explicit approval.**

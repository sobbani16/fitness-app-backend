# Phase 24 — Device Validation

Backend under test: `activity-safety-staging` @ `ef57443` (commitHash-verified).
Mobile build: staging EAS APK containing `InjuriesScreen` (built from `8c1d819`).
Device: Pixel 8 AVD (emulator-5554, Android 36). PIA disconnected during all
device work (kill-switch was a proven NAT-interference source in earlier
phases); no concurrent automation.

## Results

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 7 | Dead-token: all `AuthSession` rows deleted server-side mid-session → next authed fetch 401 → session auto-purged → cold relaunch lands on login screen (SecureStore cleared, no dashboard data) | **PASS** | `DELETE FROM "AuthSession"` ×11 → blank transition → login screen after relaunch (`/tmp/p24-dead*.png`, fcc9a14b APK) |
| 8 | Account switching: after dead-token purge, logged in as `p20-shoulder` → lands on that account's own state (incomplete-onboarding wizard), zero P21/NWB data visible | **PASS** | `/tmp/p24-switch2.png` → onboarding "About you" for shoulder account |
| 10 | New staging APK `127b68cd` (built from `8c1d819`) — embeds ONLY `activity-safety-staging-staging.up.railway.app`; installed clean on emulator; launched to login screen | **PASS** (install+launch) | bundle `strings` URL check; `/tmp/p24-new-launch.png` |
| 1 | Injury list loads: Active + Resolved sections, provenance labels, pain/WB display | **PASS** | `/tmp/p24-injuries2.png`: clinician knee "Clinician-documented · Weight-bearing: No weight on it · Pain 5/10"; 2 self-reported ankles; resolved wrist in Resolved |
| 11 | Edit form render — **real bug found on device**: form inside `ListRow` children (icon-width row container) → crushed, rows pushed off-screen, Active section appeared empty | **FAIL→FIXED** | `b9c2852`: edit `Card` renders in place of `ListRow`. 5/5 screen tests re-green (unit tests couldn't catch it — they assert elements, not layout) |
| 2 | Edit form renders correctly after fix — full-width Card with Status/Pain/Weight-bearing/Movement-limits/Activities | **PASS** | `/tmp/p24-editform.png` on APK `4968dd88` |
| 2b | PATCH save round-trip on-device (pain typed, Save never reached — input service died) | **BLOCKED** | Live PATCH semantics verified 7/7 via HTTP in Phase 23; form wiring covered by 5/5 unit tests |
| 3 | 400/409 error surfaces as Notice on-device | **NOT TESTED** | Unit-tested; API codes live-verified |
| 4 | Locked fields read-only inside clinician edit form | **NOT TESTED** | List-level provenance verified PASS; form copy unit-tested |
| 5 | Invalidation → safety card refresh on-device | **NOT TESTED** | Bus wired post-`updated:true`; server `staleAt`/`injury_updated` live-verified Phase 23 |
| 6 | App restart + session/cache behavior | **PARTIAL** | Session persisted through APK update + first relaunch; later crash-boot wiped it → login screen (safe direction: fails closed, never shows stale dashboard) |
| 9 | Trainer warnings / coaching surfaces | **NOT TESTED** | Carryover Phase 22 flag evidence; unreachable under load |

Session narrative: emulator ANR/OOM-cycled repeatedly under the user's
concurrent iOS `xcodebuild` runs (host load avg ~250, 26–33% memory free).
Evidence captured across 4 boot windows; final window ended with
`system_server`+input-service death mid-flow. All PASS rows above have
screenshots; everything else is honestly BLOCKED/NOT TESTED, not inferred.

Method notes: credentials set directly on staging DB (scrypt `salt:hash`,
synthetic accounts only); dead token produced by deleting server-side
`AuthSession` rows — a true revoked-token condition, not airplane-mode
simulation. App's `client.ts` auto-purge on 401 + `signOut()` local-clear
both exercised by the real path.

## Rerun recipe (once host is free)
1. `piactl disconnect` (kill-switch interferes with emulator NAT).
2. Cold-boot: `emulator -avd Pixel_8 -dns-server 8.8.8.8,1.1.1.1 -no-snapshot-save`.
3. Install `/tmp/p24-staging.apk` (or rebuild). Login:
   `p20-nwb-ankle-1795324061256@staging.test` / `Phase24-Device-Test-99`
   (synthetic account; password set directly on staging DB — reset before any
   real user use of this persona).
4. Today → "View symptom history" → "Manage injuries" (SafetyReport entry).
5. Verify: 3 injuries for NWB persona — clinician `knee` (locked fields
   read-only + explainer), self-reported `ankle`, resolved `wrist` in
   Resolved section.
6. Edit self-reported `ankle` pain → Save → check `PATCH /injuries` fired and
   safety card refreshed (pull to Today).
7. Attempt edit on clinician `knee` locked field → confirm fields are
   read-only (no editors rendered).
8. Force-stop → relaunch → session persists, injury state refetched.
9. `DELETE FROM "AuthSession" WHERE "userId"='p20-nwb-ankle-1795324061256'`
   mid-session → next fetch → auto-purge → login screen (reproduces step 7
   PASS from this doc).

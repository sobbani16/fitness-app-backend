# Notification & Persisted-Advice Safety (Phase 17 §6)

## Mechanism (`src/services/activitySafety/recommendationSafety.js`)

Every safety-record write route (`POST /symptoms`, `POST /injuries`, `PATCH /injuries/:id`, `DELETE /{injuries,symptoms,restrictions,feedback}/:id`) calls `invalidateSafetyAdvice(prisma, userId, reason)` after commit:

1. **J12 persisted recommendations** — open `Recommendation` rows get `staleAt`/`staleReason` stamped (additive migration `20261223000000`). Retrieval surfaces must treat `staleAt != null` as unfit to serve; the row is never deleted (audit). Scope is `userId`-only.
2. **J15 delayed notifications** — unread `Notification` rows whose `type ∈ ACTIVITY_ADVICE_TYPES` are deleted at write time. Non-advice types (`trainer.plan_assigned`, …) and already-read rows untouched — the user's history isn't rewritten, only undelivered advice is pulled.
3. **Send-time check** — producers generating activity pushes call `activityAdviceAllowed(prisma, userId)` which re-runs `safetyGate`: `suppressActivityPushes`/`reviewRequired` → suppressed; `activityPushOk === false` → suppressed. Fails closed on exceptions.

## Tests (`tests/activitySafety.notificationSafety.test.js`, 6 cases)

- injury write → open rec stale-stamped (`staleReason: 'injury_reported'`)
- completed + other-user recs untouched
- symptom write → `invalidated.recommendationsStale` in response
- unread activity-advice notifications deleted; non-advice + read rows kept
- user-scoping of the invalidation set
- `activityAdviceAllowed` suppresses pushes with an active NWB injury; healthy user → allowed

## Honest limits

- `ACTIVITY_ADVICE_TYPES` is a known-type set — a producer using a new notification type must register it or its pushes bypass suppression (documented for producers; monitoring §8 emits `safety.notification.untyped` if an unknown type reaches the suppression check).
- Mobile-side cached suggestions are covered separately by the client invalidation bus (Phase-14).
- `Recommendation` rows are not currently written by activity-safety endpoints (compute-live) — the stale mechanism pre-covers future persisted producers.

## Phase-17 §8 monitoring + §9 pool root cause

**§8** — `src/services/activitySafety/observe.js`: code/count-only events (`safety.invalidation`, `safety.push.suppressed`, `safety.gate.error`, `safety.notification.untyped`, `safety.env.outage`, `safety.rule.inert_unexplained`); high-severity events log a single structured line; `ALERTS` map defines paging thresholds. No symptom/injury/restriction text in any event.

**§9 root cause** — connection-burst flake: Postgres `max_connections=100`; long-lived dev processes held ~27 (19-day `node src/index.js` ≈9, two `next-server` ≈18) before tests began; test-time PrismaClient pools stacked on top → transient exhaustion under the full in-band run. Fix: `getPrisma()` caps `connection_limit=5` under `NODE_ENV=test` (datasource URL param). Verified: test-mode client connects and queries. Residual: heavy parallel dev tooling can still contend; documented, not concealed.

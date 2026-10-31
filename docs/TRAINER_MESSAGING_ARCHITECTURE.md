# Trainer Messaging — Architecture

Date: 2026-10-31 · Verified against `src/services/messagingService.js`, `src/routes/{conversations,pushTokens}.js`, `src/services/pushService.js`, `prisma/schema.prisma` (models 2107–2141). Flag: `trainer_messaging_enabled`. Tests: `tests/messaging.test.js` (15).

## 1. Model

| Model | Fields | Notes |
|---|---|---|
| `Conversation` | `relationId @unique` FK→TrainerClient Cascade, `createdAt`, `updatedAt` | **1:1 keyed to the relationship** — no arbitrary DMs; a pair can only ever have one conversation |
| `Message` | `conversationId` FK Cascade, `senderId`, `body` (≤4000 chars), `readAt?`, `deletedAt?`, `createdAt` | `deletedAt` exists for future soft-delete — no delete endpoint ships |
| `DevicePushToken` | `userId`, `token @unique`, `platform ios\|android` | upsert on token; not flag-gated |

Authorization: every read/write first loads the conversation and calls `requireRelationParticipant` (caller is the relation's client or the trainer's user). Creation additionally requires an **active** relation via `requireActiveRelation` + `requireApprovedTrainer` on the trainer side.

## 2. Transport: REST + polling (no WebSocket)

Rationale (per arch doc §3): simplest reliable — Railway runs one long-lived Node; WS adds Expo dev-build fragility for marginal UX gain at launch scale. Client polls `GET /conversations/:id/messages?after=<cursor>` on view focus and `GET /conversations/unread-count` on interval (piggybacks the feature-flag refresh cadence). SSE upgrade path documented, not built.

## 3. Endpoints (`/conversations`, flag + `identifyUser`)

| Method | Path | Checks | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/conversations` | participant | — | `{conversations:[{id, relationId, role, relationStatus, trainer, clientId, lastMessage, unreadCount}]}` newest-activity first | 403 |
| GET | `/conversations/unread-count` | — | — | `{count}` across own conversations | — |
| POST | `/conversations/with/:clientId` | approved trainer + active relation | — | `{conversation}` 201 created / 200 existing | 403 |
| POST | `/conversations/with-trainer/:trainerId` | client + active relation (param = trainer **profile** id) | — | same | 403 |
| GET | `/conversations/:id/messages` | participant | `?after=&limit=` (≤50) | `{messages:[…], nextCursor}` | 400 bad cursor/limit; 403/404 |
| POST | `/conversations/:id/messages` | participant + **active** relation | `{body 1–4000}` | 201 `{message}` | 400 empty/oversize; **403 ended relation** |
| POST | `/conversations/:id/read` | participant | `{lastMessageId}` | `{markedRead: n}` | 400 |
| POST | `/conversations/:id/report` | participant | — | `{reported:true}` — audit `message.report` w/ metadata only | 403 |

Push tokens (`/me/push-tokens`, `identifyUser` only, **no flag**): `POST {token, platform}` → upsert 201; `DELETE /:token` → `{removed:true}` (idempotent, own tokens only via `userId` filter).

## 4. Pagination & read semantics

| Mechanism | Detail |
|---|---|
| Cursor | `Message.id` ascending; `after` = last seen id; page ≤50 (`MAX_PAGE`) |
| ⚠ Ordering caveat | `id` is `@default(uuid())` — `ORDER BY id ASC` is **lexicographic over random UUIDs, not chronological**. Stable for cursor math and internally consistent for `markRead` (`id <= lastMessageId`), but in production messages will not arrive in `createdAt` order. Tests pass because the mocked ids are sequential (`msg-1,2,3`). Filed as a discrepancy — needs either a sequential id or `createdAt,id` ordering before scale |
| Read marker | batch: `readAt` set on every message `senderId != caller` with `id <= lastMessageId`; per-message `readAt` (1:1, no per-participant rows needed) |
| Unread count | `senderId != me AND readAt IS NULL AND deletedAt IS NULL` grouped per conversation |

## 5. Ended-relation archive

`sendMessage` hard-requires `relation.status === 'active'` → **403 'Coaching relationship ended.'** Reads (`list`, `messages`, `read`, `unread-count`, `report`) only require participation → history stays readable for both parties after drop. Retention: ended ≠ deleted; feature-off ≠ deleted either (flag only blocks API access).

## 6. Rate limiting

`messageSendLimiter` on send only: `windowMs 60s`, `limit = MESSAGE_RATE_LIMIT || 30` per `userId` (falls back to IP), standardHeaders `draft-7`, **skipped under `NODE_ENV=test`**. Stricter than the global `apiLimiter` deliberately — sends are the abuse vector.

## 7. Notifications on send (two channels, both generic)

| Channel | Content |
|---|---|
| `Notification` inbox row | `type:'trainer.message'`, title `'New message'`, body `'You have a new coaching message'` — best-effort (`try/catch` never fails the send) |
| Expo push (`sendPushToUser`) | same generic title/body + `data:{conversationId}` — **never message text** |

`pushService.sendPushToUser` → POST `https://exp.host/--/api/v2/push/send`, batched array of `{to, sound:'default', title≤128, body≤256, data}` across all of the user's tokens. **Fire-and-forget**: missing fetch, empty token list, non-2xx, and thrown errors all resolve `{sent:0}` — no caller ever sees a push failure (tested: "push transport failure never fails the send").

## 8. Privacy rules

- Message bodies are **never** written to `auditService` (report logs only `{userId}`) and never in push payloads.
- `body` trimmed, must be 1–4000 chars; no HTML sanitization server-side (rendered as text client-side).
- Cross-participant reads of a conversation a user doesn't belong to → 403/404 (`loadParticipantConversation` + `requireRelationParticipant`).

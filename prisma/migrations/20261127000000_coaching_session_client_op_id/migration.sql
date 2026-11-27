-- Additive-only: nullable unique idempotency key on coaching sessions.
-- No data mutation; legacy rows keep NULL. Partial unique index keeps
-- NULLs non-conflicting on Postgres semantics (NULLs are distinct anyway).
ALTER TABLE "CoachingSession" ADD COLUMN "clientOpId" TEXT;
CREATE UNIQUE INDEX "CoachingSession_clientOpId_key" ON "CoachingSession"("clientOpId");

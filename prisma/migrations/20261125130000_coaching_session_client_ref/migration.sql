-- Additive idempotency key for retried session creates (HUM-68/DEV5).
ALTER TABLE "CoachingSession" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "CoachingSession_userId_clientRef_key" ON "CoachingSession"("userId", "clientRef");

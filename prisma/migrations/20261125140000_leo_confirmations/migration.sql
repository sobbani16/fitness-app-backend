-- Leo confirmation gateway (HUM-90): single-use confirmations bound to
-- (userId, sessionId, toolName, argsHash) with expiry.
CREATE TABLE "LeoConfirmation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "argsHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeoConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeoConfirmation_userId_sessionId_idx" ON "LeoConfirmation"("userId", "sessionId");
ALTER TABLE "LeoConfirmation" ADD CONSTRAINT "LeoConfirmation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

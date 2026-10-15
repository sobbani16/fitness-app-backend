ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "AuthAction" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "email" TEXT NOT NULL, "purpose" TEXT NOT NULL CHECK ("purpose" IN ('verify-email', 'reset-password')),
 "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deliveredAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuthAction_userId_purpose_idx" ON "AuthAction"("userId", "purpose");
CREATE INDEX "AuthAction_deliveredAt_nextAttemptAt_idx" ON "AuthAction"("deliveredAt", "nextAttemptAt");
CREATE TABLE "AuthRateBucket" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "AuthRateBucket_expiresAt_idx" ON "AuthRateBucket"("expiresAt");

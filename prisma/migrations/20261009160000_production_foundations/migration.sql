ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT, ADD COLUMN "profileData" JSONB;
CREATE TABLE "AuthSession" (
 "tokenHash" TEXT PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE TABLE "ApiUsage" (
 "userId" TEXT NOT NULL, "date" TEXT NOT NULL, "kind" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY ("userId","date","kind")
);

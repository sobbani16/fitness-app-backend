CREATE TABLE "UserStreakPreferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pausedUntil" TIMESTAMP(3),
  "pauseDays" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserStreakPreferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserStreakPreferences_userId_key" UNIQUE ("userId")
);
CREATE INDEX "UserStreakPreferences_userId_idx" ON "UserStreakPreferences"("userId");

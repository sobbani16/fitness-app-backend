CREATE TABLE "DailyProgressDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 2,
    "earned" INTEGER NOT NULL DEFAULT 0,
    "applicable" INTEGER NOT NULL DEFAULT 100,
    "components" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyProgressDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyProgressDay_userId_dayKey_key" ON "DailyProgressDay"("userId", "dayKey");
CREATE INDEX "DailyProgressDay_userId_dayKey_idx" ON "DailyProgressDay"("userId", "dayKey");
ALTER TABLE "ReminderPreference" ADD COLUMN "timezoneMode" TEXT NOT NULL DEFAULT 'FOLLOW_DEVICE',
ADD COLUMN "lastDetectedTimezone" TEXT,
ADD COLUMN "scheduleVersion" INTEGER NOT NULL DEFAULT 1;

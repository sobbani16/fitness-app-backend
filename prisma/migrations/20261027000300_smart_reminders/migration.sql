-- CreateTable
CREATE TABLE "ReminderPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "masterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "adaptiveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "suggestionsMuted" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" TEXT,
    "quietEnd" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 3,
    "snoozeMinutes" INTEGER NOT NULL DEFAULT 30,
    "pausedUntil" TIMESTAMP(3),
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "timezoneLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderCategorySetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "times" JSONB NOT NULL DEFAULT '[]',
    "daysOfWeek" JSONB,
    "intervalMinutes" INTEGER,
    "leadMinutes" INTEGER,
    "wakingStart" TEXT,
    "wakingEnd" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderCategorySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "proposed" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReminderSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderInstance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "why" TEXT,
    "payload" JSONB,
    "snoozeUntil" TIMESTAMP(3),
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "expoPushToken" TEXT,
    "platform" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderPreference_userId_key" ON "ReminderPreference"("userId");

-- CreateIndex
CREATE INDEX "ReminderCategorySetting_userId_idx" ON "ReminderCategorySetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderCategorySetting_userId_category_key" ON "ReminderCategorySetting"("userId", "category");

-- CreateIndex
CREATE INDEX "ReminderSuggestion_userId_status_idx" ON "ReminderSuggestion"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderInstance_dedupeKey_key" ON "ReminderInstance"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReminderInstance_userId_createdAt_idx" ON "ReminderInstance"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReminderInstance_status_scheduledFor_idx" ON "ReminderInstance"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_userId_deviceId_key" ON "PushDevice"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "ReminderCategorySetting" ADD CONSTRAINT "ReminderCategorySetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ReminderPreference"("userId") ON DELETE CASCADE ON UPDATE CASCADE;


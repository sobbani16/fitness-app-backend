-- CreateTable
CREATE TABLE "EmotionalCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "energy" INTEGER NOT NULL,
    "stress" INTEGER NOT NULL,
    "emotionTags" JSONB NOT NULL DEFAULT '[]',
    "contextTags" JSONB NOT NULL DEFAULT '[]',
    "journal" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmotionalCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMindPreferences" (
    "userId" TEXT NOT NULL,
    "moduleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiJournalConsent" BOOLEAN NOT NULL DEFAULT false,
    "checkinSharingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMindPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MindExerciseCompletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseKey" TEXT NOT NULL,
    "trackKey" TEXT NOT NULL,
    "reflection" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MindExerciseCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarcodeProduct" (
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "servingSizeG" DOUBLE PRECISION,
    "servingLabel" TEXT,
    "nutrients" JSONB NOT NULL DEFAULT '{}',
    "ingredients" TEXT,
    "allergens" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'catalog',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarcodeProduct_pkey" PRIMARY KEY ("barcode")
);

-- CreateTable
CREATE TABLE "IngredientEvidenceProfile" (
    "id" TEXT NOT NULL,
    "ingredientKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "claims" JSONB NOT NULL DEFAULT '[]',
    "cautions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientEvidenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearableDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "deviceType" TEXT NOT NULL DEFAULT 'wearable',
    "displayName" TEXT,
    "externalDeviceId" TEXT,
    "firmwareVersion" TEXT,
    "connectionState" TEXT NOT NULL DEFAULT 'connected',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WearableDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthDataSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionState" TEXT NOT NULL DEFAULT 'connected',
    "permissionScopes" JSONB NOT NULL DEFAULT '[]',
    "lastSyncAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthMeasurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT,
    "deviceId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" TEXT,
    "quality" TEXT,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "HealthMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthSyncCursor" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "cursor" TEXT,
    "lastCheckpoint" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthMetricSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'day',
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "sourceCoverage" JSONB NOT NULL DEFAULT '{}',
    "calcVersion" TEXT NOT NULL DEFAULT 'v1',
    "sufficiency" TEXT NOT NULL DEFAULT 'ok',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthMetricSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmotionalCheckIn_userId_loggedAt_idx" ON "EmotionalCheckIn"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "MindExerciseCompletion_userId_completedAt_idx" ON "MindExerciseCompletion"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "IngredientEvidenceProfile_ingredientKey_status_idx" ON "IngredientEvidenceProfile"("ingredientKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientEvidenceProfile_ingredientKey_version_key" ON "IngredientEvidenceProfile"("ingredientKey", "version");

-- CreateIndex
CREATE INDEX "WearableDevice_userId_provider_idx" ON "WearableDevice"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "HealthDataSource_userId_provider_key" ON "HealthDataSource"("userId", "provider");

-- CreateIndex
CREATE INDEX "HealthMeasurement_userId_metric_startAt_idx" ON "HealthMeasurement"("userId", "metric", "startAt");

-- CreateIndex
CREATE INDEX "HealthMeasurement_provider_externalId_idx" ON "HealthMeasurement"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthSyncCursor_sourceId_metric_key" ON "HealthSyncCursor"("sourceId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "HealthMetricSummary_userId_metric_periodType_periodStart_key" ON "HealthMetricSummary"("userId", "metric", "periodType", "periodStart");

-- AddForeignKey
ALTER TABLE "HealthMeasurement" ADD CONSTRAINT "HealthMeasurement_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "HealthDataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthMeasurement" ADD CONSTRAINT "HealthMeasurement_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "WearableDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSyncCursor" ADD CONSTRAINT "HealthSyncCursor_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "HealthDataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;


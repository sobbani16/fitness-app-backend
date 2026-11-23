-- Health Outcomes P0 (HO-IMPL-2026-11-22): condition persistence fields,
-- medications, clinical measurements, rule activation + governance audit.
-- Additive only. Idempotent (IF NOT EXISTS) because the local DB carries
-- pre-existing drift vs migration history — statements for unrelated drift
-- (Recipe_sourceKey_key / Recipe_reviewStatus_idx) are intentionally excluded.

ALTER TYPE "ClinicalRuleReview" ADD VALUE IF NOT EXISTS 'IN_REVIEW';
ALTER TYPE "ClinicalRuleReview" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "ClinicalRuleReview" ADD VALUE IF NOT EXISTS 'RETIRED';

ALTER TABLE "ActivitySafetyRule"
  ADD COLUMN IF NOT EXISTS "activatedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "activeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);

ALTER TABLE "ConditionRule"
  ADD COLUMN IF NOT EXISTS "activatedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "activeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewDueAt" TIMESTAMP(3);

ALTER TABLE "HealthCondition"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "educationSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceClass" TEXT,
  ADD COLUMN IF NOT EXISTS "registryMeta" JSONB,
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

ALTER TABLE "HealthConditionNutrientRule"
  ADD COLUMN IF NOT EXISTS "activatedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "activeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewDueAt" TIMESTAMP(3);

ALTER TABLE "UserHealthCondition"
  ADD COLUMN IF NOT EXISTS "consentedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "diagnosedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'self_report',
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "Medication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "rxcui" TEXT,
    "medicationClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserMedication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicationId" TEXT,
    "nameText" TEXT NOT NULL,
    "doseText" TEXT,
    "doseValue" DOUBLE PRECISION,
    "doseUnit" TEXT,
    "schedule" JSONB,
    "medicationClass" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'user_entry',
    "lastConfirmedAt" TIMESTAMP(3),
    "consentedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserMedication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClinicalMeasurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "valueSecondary" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user_entry',
    "method" TEXT,
    "quality" TEXT NOT NULL DEFAULT 'unverified',
    "correctionOfId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClinicalMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClinicalRuleEvent" (
    "id" TEXT NOT NULL,
    "ruleTable" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleCode" TEXT,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT,
    "notes" TEXT,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicalRuleEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserClinicalReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "context" JSONB NOT NULL DEFAULT '{}',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserClinicalReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Medication_normalizedName_key" ON "Medication"("normalizedName");
CREATE INDEX IF NOT EXISTS "UserMedication_userId_active_idx" ON "UserMedication"("userId", "active");
CREATE INDEX IF NOT EXISTS "UserMedication_medicationId_idx" ON "UserMedication"("medicationId");
CREATE INDEX IF NOT EXISTS "ClinicalMeasurement_userId_metric_measuredAt_idx" ON "ClinicalMeasurement"("userId", "metric", "measuredAt");
CREATE INDEX IF NOT EXISTS "ClinicalRuleEvent_ruleTable_ruleId_idx" ON "ClinicalRuleEvent"("ruleTable", "ruleId");
CREATE INDEX IF NOT EXISTS "ClinicalRuleEvent_actorId_idx" ON "ClinicalRuleEvent"("actorId");
CREATE INDEX IF NOT EXISTS "UserClinicalReview_userId_status_idx" ON "UserClinicalReview"("userId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "HealthCondition_slug_key" ON "HealthCondition"("slug");
CREATE INDEX IF NOT EXISTS "UserHealthCondition_userId_active_idx" ON "UserHealthCondition"("userId", "active");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMedication_medicationId_fkey') THEN
    ALTER TABLE "UserMedication" ADD CONSTRAINT "UserMedication_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

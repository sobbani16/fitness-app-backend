-- Activity safety v1: structured safety profile (injuries, surgeries,
-- restrictions, symptoms, mobility/medication flags), review-gated activity
-- safety rules, evaluation provenance, environmental observations, feedback.
-- Additive only — no existing tables or indexes touched. The known Recipe
-- index drift is intentionally excluded from this migration.
-- CreateTable
CREATE TABLE "UserActivityProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walkingAbility" TEXT,
    "mobilityAids" JSONB NOT NULL DEFAULT '[]',
    "wheelchairUser" BOOLEAN NOT NULL DEFAULT false,
    "balanceLimitation" BOOLEAN NOT NULL DEFAULT false,
    "standingToleranceMin" INTEGER,
    "accessibilityNeeds" JSONB NOT NULL DEFAULT '{}',
    "preferredAdaptations" JSONB NOT NULL DEFAULT '[]',
    "pregnancyStatus" TEXT,
    "postpartumWeeks" INTEGER,
    "medicationActivityFlags" JSONB NOT NULL DEFAULT '[]',
    "fitnessExperience" TEXT,
    "activityPreferences" JSONB NOT NULL DEFAULT '[]',
    "desiredIntensity" TEXT,
    "consentScopes" JSONB NOT NULL DEFAULT '{}',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserActivityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInjury" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "laterality" TEXT NOT NULL DEFAULT 'na',
    "status" TEXT NOT NULL DEFAULT 'current',
    "injuredAt" TIMESTAMP(3),
    "painLevel" INTEGER,
    "weightBearingRestriction" TEXT,
    "rangeOfMotionRestriction" TEXT,
    "prohibitedCategories" JSONB NOT NULL DEFAULT '[]',
    "rehabInstructions" TEXT,
    "expectedReassessmentAt" TIMESTAMP(3),
    "clearanceRecordedAt" TIMESTAMP(3),
    "clearanceNote" TEXT,
    "source" TEXT NOT NULL DEFAULT 'self_reported',
    "sourceDetail" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInjury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSurgery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "procedureCategory" TEXT NOT NULL,
    "procedureDetail" TEXT,
    "performedAt" TIMESTAMP(3),
    "recoveryStage" TEXT,
    "clinicianRestrictions" JSONB NOT NULL DEFAULT '[]',
    "activityClearance" JSONB NOT NULL DEFAULT '{}',
    "reassessAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'recovering',
    "source" TEXT NOT NULL DEFAULT 'self_reported',
    "relatedInjuryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSurgery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivityRestriction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "bodyRegions" JSONB NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'prohibited',
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'self_reported',
    "clinicianNote" TEXT,
    "documentedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "reassessAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "relatedInjuryId" TEXT,
    "relatedSurgeryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserActivityRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSymptomReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symptoms" JSONB NOT NULL DEFAULT '[]',
    "severity" TEXT,
    "context" TEXT,
    "persistence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "triageOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSymptomReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySafetyRule" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "appliesTo" JSONB NOT NULL DEFAULT '{}',
    "exclusion" JSONB NOT NULL DEFAULT '{}',
    "requiredData" JSONB NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "effect" TEXT NOT NULL,
    "reason" TEXT,
    "actionHint" TEXT,
    "missingDataBehavior" TEXT NOT NULL DEFAULT 'conservative',
    "evidenceSourceId" UUID,
    "evidenceRef" TEXT,
    "evidenceClass" TEXT NOT NULL,
    "reviewStatus" "ClinicalRuleReview" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivitySafetyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySafetyEvaluation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "ruleIds" JSONB NOT NULL DEFAULT '[]',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "restrictions" JSONB NOT NULL DEFAULT '[]',
    "requiredData" JSONB NOT NULL DEFAULT '[]',
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "policyVersion" TEXT NOT NULL,
    "environmentObsId" TEXT,
    "shadow" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivitySafetyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentalObservation" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'open-meteo',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "qualityStatus" TEXT NOT NULL DEFAULT 'ok',
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentalObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySafetyFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "activityId" TEXT,
    "verdict" TEXT NOT NULL,
    "detail" TEXT,
    "resultingAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivitySafetyFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserActivityProfile_userId_key" ON "UserActivityProfile"("userId");

-- CreateIndex
CREATE INDEX "UserInjury_userId_status_idx" ON "UserInjury"("userId", "status");

-- CreateIndex
CREATE INDEX "UserInjury_bodyPart_idx" ON "UserInjury"("bodyPart");

-- CreateIndex
CREATE INDEX "UserSurgery_userId_status_idx" ON "UserSurgery"("userId", "status");

-- CreateIndex
CREATE INDEX "UserActivityRestriction_userId_status_idx" ON "UserActivityRestriction"("userId", "status");

-- CreateIndex
CREATE INDEX "UserSymptomReport_userId_status_reportedAt_idx" ON "UserSymptomReport"("userId", "status", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySafetyRule_ruleCode_key" ON "ActivitySafetyRule"("ruleCode");

-- CreateIndex
CREATE INDEX "ActivitySafetyRule_reviewStatus_category_idx" ON "ActivitySafetyRule"("reviewStatus", "category");

-- CreateIndex
CREATE INDEX "ActivitySafetyEvaluation_userId_createdAt_idx" ON "ActivitySafetyEvaluation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EnvironmentalObservation_latitude_longitude_observedAt_idx" ON "EnvironmentalObservation"("latitude", "longitude", "observedAt");

-- CreateIndex
CREATE INDEX "ActivitySafetyFeedback_userId_createdAt_idx" ON "ActivitySafetyFeedback"("userId", "createdAt");


-- AddForeignKey
ALTER TABLE "UserActivityProfile" ADD CONSTRAINT "UserActivityProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInjury" ADD CONSTRAINT "UserInjury_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSurgery" ADD CONSTRAINT "UserSurgery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityRestriction" ADD CONSTRAINT "UserActivityRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSymptomReport" ADD CONSTRAINT "UserSymptomReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySafetyRule" ADD CONSTRAINT "ActivitySafetyRule_evidenceSourceId_fkey" FOREIGN KEY ("evidenceSourceId") REFERENCES "RuleEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySafetyEvaluation" ADD CONSTRAINT "ActivitySafetyEvaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySafetyFeedback" ADD CONSTRAINT "ActivitySafetyFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clinical review gate: an ActivitySafetyRule cannot reach APPROVED without
-- the reviewer/evidence chain — mirrors the ConditionRule approval contract.
ALTER TABLE "ActivitySafetyRule"
  ADD CHECK ("version" > 0),
  ADD CHECK ("reviewStatus" <> 'APPROVED' OR ("reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "evidenceSourceId" IS NOT NULL AND "reason" IS NOT NULL));

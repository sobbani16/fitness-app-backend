CREATE TYPE "NutrientRuleAction" AS ENUM ('LIMIT', 'MONITOR', 'PRIORITIZE', 'AVOID_IF_INDICATED');
CREATE TYPE "NutrientRuleSeverity" AS ENUM ('INFO', 'CAUTION', 'HIGH');
CREATE TYPE "ClinicalRuleReview" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED');
CREATE TYPE "NutrientThresholdBasis" AS ENUM ('PER_SERVING', 'PER_100G', 'DAILY', 'OTHER');

CREATE TABLE "RuleEvidence" (
 "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE,
 "organization" TEXT NOT NULL, "guidelineTitle" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL,
 "publicationYear" INTEGER, "lastReviewedAt" TIMESTAMP(3) NOT NULL, "evidenceNotes" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "HealthConditionNutrientRule" (
 "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE,
 "healthConditionId" TEXT NOT NULL REFERENCES "HealthCondition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "nutrientId" UUID NOT NULL REFERENCES "Nutrient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "action" "NutrientRuleAction" NOT NULL, "severity" "NutrientRuleSeverity" NOT NULL DEFAULT 'INFO',
 "rationale" TEXT NOT NULL, "thresholdValue" DECIMAL(18,9), "thresholdUnit" TEXT,
 "thresholdBasis" "NutrientThresholdBasis" NOT NULL DEFAULT 'PER_SERVING',
 "applicabilityCriteria" JSONB, "requiresPersonalization" BOOLEAN NOT NULL DEFAULT false,
 "evidenceSourceId" UUID NOT NULL REFERENCES "RuleEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reviewStatus" "ClinicalRuleReview" NOT NULL DEFAULT 'DRAFT', "version" INTEGER NOT NULL DEFAULT 1,
 "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("version" > 0),
 CHECK (("thresholdValue" IS NULL AND "thresholdUnit" IS NULL) OR ("thresholdValue" >= 0 AND "thresholdValue" < 1000000000 AND "thresholdUnit" IS NOT NULL)),
 CHECK ("reviewStatus" <> 'APPROVED' OR ("reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL))
);
ALTER TABLE "ConditionRule"
 ADD COLUMN "ruleCode" TEXT UNIQUE,
 ADD COLUMN "clinicalAction" "NutrientRuleAction",
 ADD COLUMN "clinicalSeverity" "NutrientRuleSeverity" NOT NULL DEFAULT 'INFO',
 ADD COLUMN "applicabilityCriteria" JSONB,
 ADD COLUMN "requiresPersonalization" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "evidenceSourceId" UUID REFERENCES "RuleEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "reviewStatus" "ClinicalRuleReview" NOT NULL DEFAULT 'DRAFT',
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "reviewedBy" TEXT,
 ADD COLUMN "reviewedAt" TIMESTAMP(3),
 ADD CHECK ("version" > 0),
 ADD CHECK ("reviewStatus" <> 'APPROVED' OR ("reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "evidenceSourceId" IS NOT NULL AND "clinicalAction" IS NOT NULL));
CREATE INDEX "HealthConditionNutrientRule_healthConditionId_reviewStatus_idx" ON "HealthConditionNutrientRule"("healthConditionId", "reviewStatus");
CREATE INDEX "HealthConditionNutrientRule_nutrientId_idx" ON "HealthConditionNutrientRule"("nutrientId");
CREATE INDEX "HealthConditionNutrientRule_evidenceSourceId_idx" ON "HealthConditionNutrientRule"("evidenceSourceId");

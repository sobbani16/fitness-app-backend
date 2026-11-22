-- DropIndex
DROP INDEX "SupplementSchedule_userId_supplementId_key";

-- AlterTable
ALTER TABLE "Supplement" ADD COLUMN     "catalogStatus" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "ingredientId" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "reviewStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED_RESEARCH_DRAFT';

-- AlterTable
ALTER TABLE "SupplementLog" ADD COLUMN     "amount" DOUBLE PRECISION,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "occurrenceId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "SupplementSchedule" ADD COLUMN     "daysOfWeek" JSONB,
ADD COLUMN     "doseAmount" DOUBLE PRECISION,
ADD COLUMN     "doseUnit" TEXT,
ADD COLUMN     "endDate" TEXT,
ADD COLUMN     "fallbackTime" TEXT,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "mealAnchor" TEXT,
ADD COLUMN     "notifyEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "snoozeMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "startDate" TEXT,
ADD COLUMN     "timezonePolicy" TEXT NOT NULL DEFAULT 'FOLLOW_DEVICE',
ADD COLUMN     "timingRelation" TEXT NOT NULL DEFAULT 'FIXED_TIME',
ADD COLUMN     "userSupplementId" TEXT,
ADD COLUMN     "workoutAnchor" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "dose" DROP NOT NULL,
ALTER COLUMN "frequency" SET DEFAULT 'daily';

-- AlterTable
ALTER TABLE "UserSupplement" ADD COLUMN     "doseAmount" DOUBLE PRECISION,
ADD COLUMN     "doseUnit" TEXT,
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "ingredientId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "personalLabel" JSONB,
ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "SupplementIngredient" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "parentFamily" TEXT,
    "activeFamilies" TEXT,
    "productionCode" TEXT,
    "evidenceClass" TEXT,
    "researchStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED_RESEARCH_DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementAlias" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementForm" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formKey" TEXT,
    "characteristics" TEXT,
    "researchStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED_RESEARCH_DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementProduct" (
    "id" TEXT NOT NULL,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "manufacturer" TEXT,
    "formId" TEXT,
    "servingSize" DOUBLE PRECISION,
    "servingUnit" TEXT,
    "servingText" TEXT,
    "labelFacts" JSONB,
    "warnings" TEXT,
    "dataSource" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementProductIngredient" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "unit" TEXT,
    "amountKnown" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplementProductIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementEducation" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT,
    "formId" TEXT,
    "supplementId" TEXT,
    "overview" TEXT,
    "whatItIs" TEXT,
    "physiologicalRole" TEXT,
    "isEssentialNutrient" BOOLEAN,
    "bodyProduces" TEXT,
    "productionExplanation" TEXT,
    "productionInsufficiency" TEXT,
    "dietarySufficiency" TEXT,
    "foodSources" TEXT,
    "groupsWithNeeds" TEXT,
    "benefitEvidence" TEXT,
    "evidenceLimitations" TEXT,
    "timingCode" TEXT,
    "timingSuggestion" TEXT,
    "timingRationale" TEXT,
    "timingStrength" TEXT,
    "relativeAnchor" TEXT,
    "labelExceptions" TEXT,
    "adverseEffects" TEXT,
    "interactionCautions" TEXT,
    "pregnancyCaution" TEXT,
    "ageCaution" TEXT,
    "regulatoryNotes" TEXT,
    "evidenceClass" TEXT,
    "evidenceMeaning" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "lastEvidenceUpdate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementEducationSource" (
    "id" TEXT NOT NULL,
    "educationId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "scope" TEXT,
    "itemSpecific" BOOLEAN NOT NULL DEFAULT false,
    "publishedOn" TIMESTAMP(3),
    "accessedOn" TIMESTAMP(3),
    "checkedOn" TIMESTAMP(3),
    "supportsClaims" JSONB,
    "reviewerStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementEducationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementInteractionRule" (
    "id" TEXT NOT NULL,
    "ingredientSlug" TEXT NOT NULL,
    "ingredientId" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerValue" TEXT NOT NULL,
    "consumerWarning" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "ruleAction" TEXT NOT NULL,
    "minSeparationHours" DOUBLE PRECISION,
    "populationApplicability" TEXT,
    "sourceUrl" TEXT,
    "sourceId" TEXT,
    "evidenceStrength" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "requiresReviewerSignoff" BOOLEAN NOT NULL DEFAULT true,
    "qualification" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveDate" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementInteractionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementEvidenceReview" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewerRole" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementEvidenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementDoseOccurrence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "userSupplementId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "localTime" TEXT,
    "timezone" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "doseAmount" DOUBLE PRECISION,
    "doseUnit" TEXT,
    "takenLogId" TEXT,
    "snoozeUntil" TIMESTAMP(3),
    "actedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementDoseOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplementIngredient_slug_key" ON "SupplementIngredient"("slug");

-- CreateIndex
CREATE INDEX "SupplementAlias_normalized_idx" ON "SupplementAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementAlias_ingredientId_normalized_key" ON "SupplementAlias"("ingredientId", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementForm_slug_key" ON "SupplementForm"("slug");

-- CreateIndex
CREATE INDEX "SupplementProduct_brand_name_idx" ON "SupplementProduct"("brand", "name");

-- CreateIndex
CREATE INDEX "SupplementProductIngredient_ingredientId_idx" ON "SupplementProductIngredient"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementProductIngredient_productId_ingredientId_key" ON "SupplementProductIngredient"("productId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementEducation_supplementId_key" ON "SupplementEducation"("supplementId");

-- CreateIndex
CREATE INDEX "SupplementEducation_ingredientId_idx" ON "SupplementEducation"("ingredientId");

-- CreateIndex
CREATE INDEX "SupplementEducation_reviewStatus_idx" ON "SupplementEducation"("reviewStatus");

-- CreateIndex
CREATE INDEX "SupplementEducationSource_educationId_idx" ON "SupplementEducationSource"("educationId");

-- CreateIndex
CREATE INDEX "SupplementEducationSource_sourceKey_idx" ON "SupplementEducationSource"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementInteractionRule_dedupeKey_key" ON "SupplementInteractionRule"("dedupeKey");

-- CreateIndex
CREATE INDEX "SupplementInteractionRule_ingredientSlug_idx" ON "SupplementInteractionRule"("ingredientSlug");

-- CreateIndex
CREATE INDEX "SupplementInteractionRule_approved_reviewStatus_idx" ON "SupplementInteractionRule"("approved", "reviewStatus");

-- CreateIndex
CREATE INDEX "SupplementEvidenceReview_entityType_entityId_idx" ON "SupplementEvidenceReview"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementDoseOccurrence_dedupeKey_key" ON "SupplementDoseOccurrence"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementDoseOccurrence_idempotencyKey_key" ON "SupplementDoseOccurrence"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplementDoseOccurrence_userId_localDate_idx" ON "SupplementDoseOccurrence"("userId", "localDate");

-- CreateIndex
CREATE INDEX "SupplementDoseOccurrence_status_scheduledFor_idx" ON "SupplementDoseOccurrence"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Supplement_catalogStatus_idx" ON "Supplement"("catalogStatus");

-- CreateIndex
CREATE INDEX "Supplement_ownerId_idx" ON "Supplement"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementLog_idempotencyKey_key" ON "SupplementLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplementLog_occurrenceId_idx" ON "SupplementLog"("occurrenceId");

-- CreateIndex
CREATE INDEX "SupplementSchedule_userSupplementId_idx" ON "SupplementSchedule"("userSupplementId");

-- CreateIndex
CREATE INDEX "UserSupplement_ingredientId_idx" ON "UserSupplement"("ingredientId");

-- AddForeignKey
ALTER TABLE "Supplement" ADD CONSTRAINT "Supplement_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplement" ADD CONSTRAINT "Supplement_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SupplementForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplement" ADD CONSTRAINT "Supplement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SupplementProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupplement" ADD CONSTRAINT "UserSupplement_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupplement" ADD CONSTRAINT "UserSupplement_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SupplementForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupplement" ADD CONSTRAINT "UserSupplement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SupplementProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementLog" ADD CONSTRAINT "SupplementLog_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "SupplementDoseOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementSchedule" ADD CONSTRAINT "SupplementSchedule_userSupplementId_fkey" FOREIGN KEY ("userSupplementId") REFERENCES "UserSupplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementAlias" ADD CONSTRAINT "SupplementAlias_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementForm" ADD CONSTRAINT "SupplementForm_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementProduct" ADD CONSTRAINT "SupplementProduct_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SupplementForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementProductIngredient" ADD CONSTRAINT "SupplementProductIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SupplementProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementProductIngredient" ADD CONSTRAINT "SupplementProductIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementEducation" ADD CONSTRAINT "SupplementEducation_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementEducation" ADD CONSTRAINT "SupplementEducation_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SupplementForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementEducation" ADD CONSTRAINT "SupplementEducation_supplementId_fkey" FOREIGN KEY ("supplementId") REFERENCES "Supplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementEducationSource" ADD CONSTRAINT "SupplementEducationSource_educationId_fkey" FOREIGN KEY ("educationId") REFERENCES "SupplementEducation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementInteractionRule" ADD CONSTRAINT "SupplementInteractionRule_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "SupplementIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementDoseOccurrence" ADD CONSTRAINT "SupplementDoseOccurrence_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "SupplementSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementDoseOccurrence" ADD CONSTRAINT "SupplementDoseOccurrence_userSupplementId_fkey" FOREIGN KEY ("userSupplementId") REFERENCES "UserSupplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


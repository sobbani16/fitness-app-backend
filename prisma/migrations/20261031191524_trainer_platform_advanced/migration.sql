-- AlterTable
ALTER TABLE "TrainerClient" ADD COLUMN     "requestedBy" TEXT;

-- AlterTable
ALTER TABLE "TrainerProfile" ADD COLUMN     "applicationNote" TEXT,
ADD COLUMN     "applicationStatus" TEXT NOT NULL DEFAULT 'submitted',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "coachingMode" TEXT NOT NULL DEFAULT 'both',
ADD COLUMN     "country" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "isDiscoverable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "philosophy" TEXT,
ADD COLUMN     "timeZone" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "WorkoutPlan" ADD COLUMN     "daysPerWeek" INTEGER,
ADD COLUMN     "difficulty" TEXT,
ADD COLUMN     "durationWeeks" INTEGER,
ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "startAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkoutPlanExercise" ADD COLUMN     "progression" TEXT,
ADD COLUMN     "restSeconds" INTEGER,
ADD COLUMN     "tempo" TEXT;

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "planAssignmentId" TEXT;

-- CreateTable
CREATE TABLE "TrainerWorkoutDay" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "label" TEXT,
    "warmup" TEXT,
    "cooldown" TEXT,
    "notes" TEXT,

    CONSTRAINT "TrainerWorkoutDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerWorkoutExercise" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "exerciseId" TEXT,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER,
    "repsText" TEXT,
    "targetWeight" DOUBLE PRECISION,
    "weightGuidance" TEXT,
    "restSeconds" INTEGER,
    "tempo" TEXT,
    "progression" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainerWorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerWorkoutAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TrainerWorkoutAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerWorkoutFeedback" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workoutSessionId" TEXT,
    "rating" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerWorkoutFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerCertification" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuingOrganization" TEXT,
    "credentialId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerClientConsent" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "policyVersion" TEXT NOT NULL DEFAULT 'v1',
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerClientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNutritionPlan" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "guidanceText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerNutritionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNutritionPlanMeal" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "timing" TEXT,
    "notes" TEXT,

    CONSTRAINT "TrainerNutritionPlanMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNutritionPlanItem" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "recipeId" TEXT,
    "foodName" TEXT,
    "quantityG" DOUBLE PRECISION NOT NULL,
    "substitutions" JSONB,

    CONSTRAINT "TrainerNutritionPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNutritionTargets" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "caloriesKcal" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "waterMl" DOUBLE PRECISION,

    CONSTRAINT "TrainerNutritionTargets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNutritionAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TrainerNutritionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNutritionFeedback" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rating" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerNutritionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevicePushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerAvailability" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "TrainerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerSessionType" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'virtual',
    "meetingLink" TEXT,
    "bufferMin" INTEGER NOT NULL DEFAULT 0,
    "minNoticeMin" INTEGER NOT NULL DEFAULT 1440,
    "cancelWindowMin" INTEGER NOT NULL DEFAULT 1440,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TrainerSessionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerSchedulingPreference" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',

    CONSTRAINT "TrainerSchedulingPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerBooking" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "sessionTypeId" TEXT NOT NULL,
    "startAtUtc" TIMESTAMP(3) NOT NULL,
    "endAtUtc" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedBy" TEXT NOT NULL,
    "meetingLink" TEXT,
    "clientNote" TEXT,
    "trainerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerBookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStart" TIMESTAMP(3),
    "toStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerBookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerCoachingPackage" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sessionCount" INTEGER,
    "interval" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TrainerCoachingPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerPurchase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerSubscription" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),

    CONSTRAINT "TrainerSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerEntitlement" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "clientId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remainingSessions" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "TrainerEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerPaymentTransaction" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerPaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerPayout" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRef" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerRefund" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerPromotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER,
    "amountOffCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainerWorkoutDay_planId_dayIndex_key" ON "TrainerWorkoutDay"("planId", "dayIndex");

-- CreateIndex
CREATE INDEX "TrainerWorkoutExercise_dayId_idx" ON "TrainerWorkoutExercise"("dayId");

-- CreateIndex
CREATE INDEX "TrainerWorkoutAssignment_planId_idx" ON "TrainerWorkoutAssignment"("planId");

-- CreateIndex
CREATE INDEX "TrainerWorkoutAssignment_clientId_idx" ON "TrainerWorkoutAssignment"("clientId");

-- CreateIndex
CREATE INDEX "TrainerWorkoutFeedback_assignmentId_idx" ON "TrainerWorkoutFeedback"("assignmentId");

-- CreateIndex
CREATE INDEX "TrainerCertification_trainerId_idx" ON "TrainerCertification"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerClientConsent_relationId_idx" ON "TrainerClientConsent"("relationId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerClientConsent_relationId_category_key" ON "TrainerClientConsent"("relationId", "category");

-- CreateIndex
CREATE INDEX "TrainerNutritionPlan_trainerId_idx" ON "TrainerNutritionPlan"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerNutritionPlan_clientId_idx" ON "TrainerNutritionPlan"("clientId");

-- CreateIndex
CREATE INDEX "TrainerNutritionPlanMeal_planId_idx" ON "TrainerNutritionPlanMeal"("planId");

-- CreateIndex
CREATE INDEX "TrainerNutritionPlanItem_mealId_idx" ON "TrainerNutritionPlanItem"("mealId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerNutritionTargets_planId_key" ON "TrainerNutritionTargets"("planId");

-- CreateIndex
CREATE INDEX "TrainerNutritionAssignment_planId_idx" ON "TrainerNutritionAssignment"("planId");

-- CreateIndex
CREATE INDEX "TrainerNutritionAssignment_clientId_idx" ON "TrainerNutritionAssignment"("clientId");

-- CreateIndex
CREATE INDEX "TrainerNutritionFeedback_assignmentId_idx" ON "TrainerNutritionFeedback"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_relationId_key" ON "Conversation"("relationId");

-- CreateIndex
CREATE INDEX "Conversation_relationId_idx" ON "Conversation"("relationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_id_idx" ON "Message"("conversationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePushToken_token_key" ON "DevicePushToken"("token");

-- CreateIndex
CREATE INDEX "DevicePushToken_userId_idx" ON "DevicePushToken"("userId");

-- CreateIndex
CREATE INDEX "TrainerAvailability_trainerId_idx" ON "TrainerAvailability"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerSessionType_trainerId_idx" ON "TrainerSessionType"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerSchedulingPreference_trainerId_key" ON "TrainerSchedulingPreference"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerBooking_relationId_idx" ON "TrainerBooking"("relationId");

-- CreateIndex
CREATE INDEX "TrainerBooking_sessionTypeId_startAtUtc_idx" ON "TrainerBooking"("sessionTypeId", "startAtUtc");

-- CreateIndex
CREATE INDEX "TrainerBookingEvent_bookingId_idx" ON "TrainerBookingEvent"("bookingId");

-- CreateIndex
CREATE INDEX "TrainerCoachingPackage_trainerId_idx" ON "TrainerCoachingPackage"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPurchase_providerRef_key" ON "TrainerPurchase"("providerRef");

-- CreateIndex
CREATE INDEX "TrainerPurchase_clientId_idx" ON "TrainerPurchase"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerSubscription_purchaseId_key" ON "TrainerSubscription"("purchaseId");

-- CreateIndex
CREATE INDEX "TrainerEntitlement_clientId_status_idx" ON "TrainerEntitlement"("clientId", "status");

-- CreateIndex
CREATE INDEX "TrainerEntitlement_trainerId_idx" ON "TrainerEntitlement"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPaymentTransaction_providerEventId_key" ON "TrainerPaymentTransaction"("providerEventId");

-- CreateIndex
CREATE INDEX "TrainerPaymentTransaction_purchaseId_idx" ON "TrainerPaymentTransaction"("purchaseId");

-- CreateIndex
CREATE INDEX "TrainerPayout_trainerId_idx" ON "TrainerPayout"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPromotion_code_key" ON "TrainerPromotion"("code");

-- CreateIndex
CREATE INDEX "WorkoutSession_planAssignmentId_idx" ON "WorkoutSession"("planAssignmentId");

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "WorkoutPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerWorkoutDay" ADD CONSTRAINT "TrainerWorkoutDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerWorkoutExercise" ADD CONSTRAINT "TrainerWorkoutExercise_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "TrainerWorkoutDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerWorkoutAssignment" ADD CONSTRAINT "TrainerWorkoutAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerWorkoutFeedback" ADD CONSTRAINT "TrainerWorkoutFeedback_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainerWorkoutAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerCertification" ADD CONSTRAINT "TrainerCertification_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerClientConsent" ADD CONSTRAINT "TrainerClientConsent_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNutritionPlan" ADD CONSTRAINT "TrainerNutritionPlan_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNutritionPlanMeal" ADD CONSTRAINT "TrainerNutritionPlanMeal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainerNutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNutritionPlanItem" ADD CONSTRAINT "TrainerNutritionPlanItem_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "TrainerNutritionPlanMeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNutritionTargets" ADD CONSTRAINT "TrainerNutritionTargets_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainerNutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNutritionAssignment" ADD CONSTRAINT "TrainerNutritionAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainerNutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNutritionFeedback" ADD CONSTRAINT "TrainerNutritionFeedback_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainerNutritionAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerAvailability" ADD CONSTRAINT "TrainerAvailability_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerSessionType" ADD CONSTRAINT "TrainerSessionType_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerSchedulingPreference" ADD CONSTRAINT "TrainerSchedulingPreference_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerBooking" ADD CONSTRAINT "TrainerBooking_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerBooking" ADD CONSTRAINT "TrainerBooking_sessionTypeId_fkey" FOREIGN KEY ("sessionTypeId") REFERENCES "TrainerSessionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerBookingEvent" ADD CONSTRAINT "TrainerBookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TrainerBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerCoachingPackage" ADD CONSTRAINT "TrainerCoachingPackage_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerPurchase" ADD CONSTRAINT "TrainerPurchase_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TrainerCoachingPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerSubscription" ADD CONSTRAINT "TrainerSubscription_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "TrainerPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerEntitlement" ADD CONSTRAINT "TrainerEntitlement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "TrainerPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerPaymentTransaction" ADD CONSTRAINT "TrainerPaymentTransaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "TrainerPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerPayout" ADD CONSTRAINT "TrainerPayout_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerRefund" ADD CONSTRAINT "TrainerRefund_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "TrainerPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

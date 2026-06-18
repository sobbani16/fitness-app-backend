-- AlterTable
ALTER TABLE "TrainerClient" ADD COLUMN     "dropReason" TEXT,
ADD COLUMN     "droppedBy" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "TrainerProfile" ADD COLUMN     "location" TEXT,
ADD COLUMN     "monthlyRateUsd" DOUBLE PRECISION,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "tier" SET DEFAULT 'standard';

-- CreateTable
CREATE TABLE "TrainerDropForm" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "droppedBy" TEXT NOT NULL,
    "reasons" TEXT[],
    "notes" TEXT,
    "candidateGoals" TEXT,
    "adherenceRating" INTEGER,
    "trainerRating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerDropForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerWaitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainerDropForm_relationId_idx" ON "TrainerDropForm"("relationId");

-- CreateIndex
CREATE INDEX "TrainerDropForm_clientId_idx" ON "TrainerDropForm"("clientId");

-- CreateIndex
CREATE INDEX "TrainerDropForm_trainerId_idx" ON "TrainerDropForm"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerWaitlist_userId_idx" ON "TrainerWaitlist"("userId");

-- CreateIndex
CREATE INDEX "TrainerWaitlist_trainerId_idx" ON "TrainerWaitlist"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerWaitlist_userId_trainerId_key" ON "TrainerWaitlist"("userId", "trainerId");

-- AddForeignKey
ALTER TABLE "TrainerDropForm" ADD CONSTRAINT "TrainerDropForm_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerDropForm" ADD CONSTRAINT "TrainerDropForm_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

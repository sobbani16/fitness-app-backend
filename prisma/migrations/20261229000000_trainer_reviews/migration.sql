-- TrainerReview (pc-HUM-143 phase-10 reviews)
CREATE TABLE "TrainerReview" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "quality" INTEGER,
    "communication" INTEGER,
    "professionalism" INTEGER,
    "reliability" INTEGER,
    "clarity" INTEGER,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "flaggedReason" TEXT,
    "responseBody" TEXT,
    "responseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainerReview_trainerId_clientId_key" ON "TrainerReview"("trainerId", "clientId");
CREATE INDEX "TrainerReview_trainerId_status_idx" ON "TrainerReview"("trainerId", "status");

-- ExerciseIntelligenceProfile (pc-HUM-108 §26 additive migration)
CREATE TABLE "ExerciseIntelligenceProfile" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "movementFamily" TEXT NOT NULL,
    "secondaryFamilies" TEXT NOT NULL DEFAULT '[]',
    "movementSubtype" TEXT,
    "trackingMethod" TEXT NOT NULL DEFAULT 'manual',
    "coachingCapability" TEXT NOT NULL DEFAULT 'none',
    "capabilities" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseIntelligenceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExerciseIntelligenceProfile_exerciseId_version_key" ON "ExerciseIntelligenceProfile"("exerciseId", "version");
CREATE INDEX "ExerciseIntelligenceProfile_exerciseId_status_idx" ON "ExerciseIntelligenceProfile"("exerciseId", "status");

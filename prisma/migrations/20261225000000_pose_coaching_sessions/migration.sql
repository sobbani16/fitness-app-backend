-- Pose coaching sessions — additive only, fully reversible.
-- Stores landmark-derived analytics only; no raw frames or video.

-- CreateTable
CREATE TABLE "CoachingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "devicePlatform" TEXT,
    "appBuild" TEXT,
    "modelVersion" TEXT,
    "ruleVersion" TEXT,
    "cameraView" TEXT,
    "countedReps" INTEGER NOT NULL DEFAULT 0,
    "confirmedReps" INTEGER,
    "discarded" BOOLEAN NOT NULL DEFAULT false,
    "consentToStore" BOOLEAN NOT NULL DEFAULT true,
    "repDiagnostics" JSONB,
    "corrections" JSONB,
    "observations" JSONB,
    "limitations" TEXT,
    "source" TEXT NOT NULL DEFAULT 'camera',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachingSession_userId_exerciseId_idx" ON "CoachingSession"("userId", "exerciseId");

-- CreateIndex
CREATE INDEX "CoachingSession_userId_startedAt_idx" ON "CoachingSession"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

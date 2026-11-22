CREATE TABLE "BaselineAssessment" (
    "id" TEXT NOT NULL, "relationId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "data" JSONB NOT NULL DEFAULT '{}',
    "supersedesId" TEXT, "updatedBy" TEXT,
    "submittedAt" TIMESTAMP(3), "submittedBy" TEXT,
    "reviewedAt" TIMESTAMP(3), "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BaselineAssessment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BaselineAssessment_clientId_idx" ON "BaselineAssessment"("clientId");
CREATE INDEX "BaselineAssessment_trainerId_idx" ON "BaselineAssessment"("trainerId");
CREATE UNIQUE INDEX "BaselineAssessment_relationId_version_key" ON "BaselineAssessment"("relationId", "version");
ALTER TABLE "BaselineAssessment" ADD CONSTRAINT "BaselineAssessment_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

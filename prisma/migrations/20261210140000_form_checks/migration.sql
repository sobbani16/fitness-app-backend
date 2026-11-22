CREATE TABLE "FormCheckRequest" (
    "id" TEXT NOT NULL, "relationId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
    "exerciseKey" TEXT, "exerciseName" TEXT, "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "videoKey" TEXT, "videoName" TEXT, "videoMime" TEXT, "videoBytes" INTEGER,
    "consentAt" TIMESTAMP(3), "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3), "memberAckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormCheckRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FormCheckRequest_clientId_status_idx" ON "FormCheckRequest"("clientId", "status");
CREATE INDEX "FormCheckRequest_trainerId_status_idx" ON "FormCheckRequest"("trainerId", "status");
CREATE INDEX "FormCheckRequest_relationId_idx" ON "FormCheckRequest"("relationId");
ALTER TABLE "FormCheckRequest" ADD CONSTRAINT "FormCheckRequest_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormCheckFeedback" (
    "id" TEXT NOT NULL, "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL, "timestampSec" DOUBLE PRECISION,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormCheckFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FormCheckFeedback_requestId_idx" ON "FormCheckFeedback"("requestId");
ALTER TABLE "FormCheckFeedback" ADD CONSTRAINT "FormCheckFeedback_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FormCheckRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

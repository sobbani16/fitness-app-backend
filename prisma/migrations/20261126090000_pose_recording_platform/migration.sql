CREATE TABLE "PoseConsent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "participantKey" TEXT NOT NULL,
  "scopeItems" JSONB NOT NULL,
  "consentVersion" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revocationChannel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoseConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PoseConsent_userId_idx" ON "PoseConsent"("userId");
CREATE INDEX "PoseConsent_participantKey_idx" ON "PoseConsent"("participantKey");

CREATE TABLE "PoseClip" (
  "id" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "participantKey" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL DEFAULT 'humai-self-recorded',
  "storageRef" TEXT NOT NULL,
  "landmarkOnly" BOOLEAN NOT NULL DEFAULT true,
  "durationMs" INTEGER NOT NULL,
  "frameCount" INTEGER,
  "viewpoint" TEXT,
  "sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'registered',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PoseClip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PoseClip_participantKey_idx" ON "PoseClip"("participantKey");
CREATE INDEX "PoseClip_exerciseId_status_idx" ON "PoseClip"("exerciseId", "status");
ALTER TABLE "PoseClip" ADD CONSTRAINT "PoseClip_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "PoseConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

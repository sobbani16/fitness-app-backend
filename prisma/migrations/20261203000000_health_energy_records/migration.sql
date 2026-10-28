-- Imported wearable active-energy records. Informational only; never
-- merged into TDEE-derived targets. Dedupe via (userId, provider, sourceId).
CREATE TABLE "HealthEnergyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "activeKcal" DOUBLE PRECISION NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "HealthEnergyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HealthEnergyRecord_userId_provider_sourceId_key" ON "HealthEnergyRecord"("userId", "provider", "sourceId");
CREATE INDEX "HealthEnergyRecord_userId_startAt_idx" ON "HealthEnergyRecord"("userId", "startAt");

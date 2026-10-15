CREATE TABLE "LegacyMigrationGrant" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE,
 "legacyUserId" TEXT NOT NULL, "targetUserId" TEXT NOT NULL,
 "proofType" TEXT NOT NULL, "evidenceReference" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3)
);
CREATE INDEX "LegacyMigrationGrant_legacyUserId_idx" ON "LegacyMigrationGrant"("legacyUserId");
CREATE INDEX "LegacyMigrationGrant_targetUserId_idx" ON "LegacyMigrationGrant"("targetUserId");

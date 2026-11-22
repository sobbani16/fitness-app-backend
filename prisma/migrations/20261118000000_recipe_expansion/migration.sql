ALTER TABLE "Recipe" ADD COLUMN "region" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Recipe" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE "Recipe" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "finishedYieldG" DOUBLE PRECISION;
CREATE UNIQUE INDEX "Recipe_sourceKey_key" ON "Recipe"("sourceKey") WHERE "sourceKey" IS NOT NULL;
CREATE INDEX "Recipe_reviewStatus_idx" ON "Recipe"("reviewStatus");

-- Additive scan-evidence columns; existing ScannedLabel rows keep working via defaults.
ALTER TABLE "ScannedLabel" ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ScannedLabel" ADD COLUMN "extraction" JSONB;
ALTER TABLE "ScannedLabel" ADD COLUMN "userCorrections" JSONB;

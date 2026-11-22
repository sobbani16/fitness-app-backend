ALTER TABLE "Recommendation" ADD COLUMN "staleAt" TIMESTAMP(3);
ALTER TABLE "Recommendation" ADD COLUMN "staleReason" TEXT;

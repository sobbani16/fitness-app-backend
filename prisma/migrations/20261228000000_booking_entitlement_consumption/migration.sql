-- Booking entitlement consumption — additive only, fully reversible.
-- Links a booking to the entitlement it consumed so cancellations/declines
-- can restore the session exactly once.

-- AlterTable
ALTER TABLE "TrainerBooking" ADD COLUMN "entitlementId" TEXT;

-- AddForeignKey
ALTER TABLE "TrainerBooking" ADD CONSTRAINT "TrainerBooking_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "TrainerEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "TrainerBooking_entitlementId_idx" ON "TrainerBooking"("entitlementId");

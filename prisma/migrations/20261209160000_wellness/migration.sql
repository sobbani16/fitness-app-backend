CREATE TABLE "WellnessCheckIn" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL,
    "stress" INTEGER NOT NULL, "mood" INTEGER NOT NULL, "fatigue" INTEGER NOT NULL,
    "note" TEXT, "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WellnessCheckIn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WellnessCheckIn_userId_loggedAt_idx" ON "WellnessCheckIn"("userId", "loggedAt");
ALTER TABLE "WellnessCheckIn" ADD CONSTRAINT "WellnessCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

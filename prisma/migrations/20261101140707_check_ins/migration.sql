-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "goalProgress" TEXT,
    "workoutDifficulty" INTEGER,
    "energyLevel" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "questions" TEXT,
    "challenges" TEXT,
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "trainerReply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckIn_clientId_idx" ON "CheckIn"("clientId");

-- CreateIndex
CREATE INDEX "CheckIn_relationId_idx" ON "CheckIn"("relationId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_relationId_weekOf_key" ON "CheckIn"("relationId", "weekOf");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

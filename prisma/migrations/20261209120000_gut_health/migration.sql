CREATE TABLE "GutSymptom" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "symptom" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 3, "bristol" INTEGER, "note" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GutSymptom_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GutSymptom_userId_loggedAt_idx" ON "GutSymptom"("userId", "loggedAt");
ALTER TABLE "GutSymptom" ADD CONSTRAINT "GutSymptom_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FoodTolerance" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "foodName" TEXT NOT NULL,
    "kind" TEXT NOT NULL, "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FoodTolerance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FoodTolerance_userId_kind_idx" ON "FoodTolerance"("userId", "kind");
ALTER TABLE "FoodTolerance" ADD CONSTRAINT "FoodTolerance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

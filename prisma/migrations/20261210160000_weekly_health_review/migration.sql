CREATE TABLE "WeeklyHealthReview" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "weekOf" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyHealthReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WeeklyHealthReview_userId_weekOf_key" UNIQUE ("userId", "weekOf")
);
CREATE INDEX "WeeklyHealthReview_userId_createdAt_idx" ON "WeeklyHealthReview"("userId", "createdAt");

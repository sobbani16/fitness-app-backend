-- Scoring v2 support tables — additive only, no existing data touched.
CREATE TABLE "ScorePolicyVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "caps" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScorePolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScorePolicyVersion_version_key" ON "ScorePolicyVersion"("version");

CREATE TABLE "DailyScoreSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "version" TEXT NOT NULL,
    "composite" DOUBLE PRECISION,
    "state" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyScoreSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyScoreSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DailyScoreSnapshot_userId_date_version_key" ON "DailyScoreSnapshot"("userId", "date", "version");
CREATE INDEX "DailyScoreSnapshot_userId_date_idx" ON "DailyScoreSnapshot"("userId", "date");

CREATE TABLE "GoalHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "targetsSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "GoalHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoalHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "GoalHistory_userId_endedAt_idx" ON "GoalHistory"("userId", "endedAt");

CREATE TABLE "ScenarioDefinition" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "data" JSONB,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScenarioDefinition_pkey" PRIMARY KEY ("id")
);

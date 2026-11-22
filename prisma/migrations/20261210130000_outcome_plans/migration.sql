CREATE TABLE "OutcomePlan" (
    "id" TEXT NOT NULL, "relationId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT, "supersedesId" TEXT, "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutcomePlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutcomePlan_relationId_version_key" ON "OutcomePlan"("relationId", "version");
CREATE INDEX "OutcomePlan_clientId_status_idx" ON "OutcomePlan"("clientId", "status");
CREATE INDEX "OutcomePlan_trainerId_status_idx" ON "OutcomePlan"("trainerId", "status");
ALTER TABLE "OutcomePlan" ADD CONSTRAINT "OutcomePlan_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OutcomeGoal" (
    "id" TEXT NOT NULL, "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom', "title" TEXT NOT NULL,
    "baseline" TEXT, "target" TEXT, "targetDate" TIMESTAMP(3),
    "reviewIntervalDays" INTEGER NOT NULL DEFAULT 7,
    "progressSource" TEXT NOT NULL DEFAULT 'self_report',
    "notes" TEXT, "status" TEXT NOT NULL DEFAULT 'open',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutcomeGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutcomeGoal_planId_idx" ON "OutcomeGoal"("planId");
ALTER TABLE "OutcomeGoal" ADD CONSTRAINT "OutcomeGoal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OutcomePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OutcomePlanAdjustment" (
    "id" TEXT NOT NULL, "planId" TEXT NOT NULL,
    "adjustedBy" TEXT NOT NULL, "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutcomePlanAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutcomePlanAdjustment_planId_idx" ON "OutcomePlanAdjustment"("planId");
ALTER TABLE "OutcomePlanAdjustment" ADD CONSTRAINT "OutcomePlanAdjustment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OutcomePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

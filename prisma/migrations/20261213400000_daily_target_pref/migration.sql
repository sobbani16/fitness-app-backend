ALTER TABLE "UserPlanningPreferences" ADD COLUMN "dailyTarget" INTEGER;
ALTER TABLE "UserPlanningPreferences" ADD COLUMN "targetMode" TEXT NOT NULL DEFAULT 'starter';

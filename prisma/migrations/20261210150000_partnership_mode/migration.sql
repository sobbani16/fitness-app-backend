ALTER TABLE "CoachingPreference"
ADD COLUMN "planPrecedence" TEXT NOT NULL DEFAULT 'trainer_first',
ADD COLUMN "shareInsightsWithTrainer" BOOLEAN NOT NULL DEFAULT false;

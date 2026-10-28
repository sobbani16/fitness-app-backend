-- AlterTable
ALTER TABLE "DailySteps" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'app';

-- AlterTable
ALTER TABLE "WaterLog" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'app';

-- AlterTable
ALTER TABLE "SleepLog" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'app';

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'app';


-- AlterTable
ALTER TABLE "ReminderPreference" ADD COLUMN     "pauseReason" TEXT;

-- AlterTable
ALTER TABLE "ReminderCategorySetting" ADD COLUMN     "triggerDelay" INTEGER,
ADD COLUMN     "triggerEvent" TEXT;


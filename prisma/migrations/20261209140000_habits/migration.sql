CREATE TABLE "Habit" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom', "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
    "status" TEXT NOT NULL DEFAULT 'active', "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Habit_userId_status_idx" ON "Habit"("userId", "status");
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HabitCompletion" (
    "id" TEXT NOT NULL, "habitId" TEXT NOT NULL, "day" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'done',
    CONSTRAINT "HabitCompletion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HabitCompletion_habitId_day_key" UNIQUE ("habitId", "day")
);
ALTER TABLE "HabitCompletion" ADD CONSTRAINT "HabitCompletion_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "AuthAction" DROP CONSTRAINT "AuthAction_userId_fkey";

-- DropForeignKey
ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_userId_fkey";

-- AlterTable
ALTER TABLE "IngredientCatalog" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "level" TEXT,
    "force" TEXT,
    "mechanic" TEXT,
    "equipment" TEXT,
    "appEquipment" TEXT[],
    "category" TEXT,
    "instructions" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'free-exercise-db',
    "sourceId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'imported',

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseMuscle" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "muscle" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ExerciseMuscle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_normalizedName_key" ON "Exercise"("normalizedName");

-- CreateIndex
CREATE INDEX "Exercise_normalizedName_idx" ON "Exercise"("normalizedName");

-- CreateIndex
CREATE INDEX "Exercise_appEquipment_idx" ON "Exercise"("appEquipment");

-- CreateIndex
CREATE INDEX "ExerciseMuscle_muscle_role_idx" ON "ExerciseMuscle"("muscle", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseMuscle_exerciseId_muscle_role_key" ON "ExerciseMuscle"("exerciseId", "muscle", "role");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAction" ADD CONSTRAINT "AuthAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseMuscle" ADD CONSTRAINT "ExerciseMuscle_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Supplement" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "calories" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "carbsG" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fatG" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fiberG" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "flavor" TEXT,
ADD COLUMN     "proteinG" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "servingSizeG" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "UserSupplement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "lastTakenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSupplement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSupplement_userId_idx" ON "UserSupplement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSupplement_userId_supplementId_key" ON "UserSupplement"("userId", "supplementId");

-- AddForeignKey
ALTER TABLE "UserSupplement" ADD CONSTRAINT "UserSupplement_supplementId_fkey" FOREIGN KEY ("supplementId") REFERENCES "Supplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

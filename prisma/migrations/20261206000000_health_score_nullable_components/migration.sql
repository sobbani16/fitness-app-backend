-- Component scores become nullable: NULL means "no records existed for this
-- component", which must never be stored as a fake 0. Overall score stays
-- required because days with zero available components are not persisted.
ALTER TABLE "HealthScore" ALTER COLUMN "macroScore" DROP NOT NULL,
  ALTER COLUMN "conditionScore" DROP NOT NULL,
  ALTER COLUMN "foodQualityScore" DROP NOT NULL,
  ALTER COLUMN "activityScore" DROP NOT NULL,
  ALTER COLUMN "recoveryScore" DROP NOT NULL,
  ALTER COLUMN "macroScore" DROP DEFAULT,
  ALTER COLUMN "conditionScore" DROP DEFAULT,
  ALTER COLUMN "foodQualityScore" DROP DEFAULT,
  ALTER COLUMN "activityScore" DROP DEFAULT,
  ALTER COLUMN "recoveryScore" DROP DEFAULT;

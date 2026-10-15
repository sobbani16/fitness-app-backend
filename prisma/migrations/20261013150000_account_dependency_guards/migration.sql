-- Waitlist entries have no Prisma relation to TrainerProfile. Protect late inserts.
CREATE FUNCTION trainer_waitlist_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "TrainerProfile" WHERE "id" = NEW."trainerId" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trainer no longer exists' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TrainerWaitlist_trainer_guard" BEFORE INSERT OR UPDATE ON "TrainerWaitlist"
FOR EACH ROW EXECUTE FUNCTION trainer_waitlist_guard();

CREATE FUNCTION recipe_creator_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text;
BEGIN
  IF NEW."isSystem" THEN RETURN NEW; END IF;
  SELECT "userId" INTO owner_id FROM "CreatorProfile" WHERE "id" = NEW."creatorId" FOR KEY SHARE;
  IF owner_id IS NULL THEN owner_id := NEW."creatorId"; END IF;
  PERFORM 1 FROM "User" WHERE "id" = owner_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Creator account no longer exists' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Recipe_creator_guard" BEFORE INSERT OR UPDATE ON "Recipe"
FOR EACH ROW EXECUTE FUNCTION recipe_creator_guard();

CREATE FUNCTION deleted_account_restore_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AccountDeletionReceipt" WHERE "userId" = NEW."id") THEN
    RAISE EXCEPTION 'Account was deleted; restore is forbidden' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_restore_guard" BEFORE INSERT ON "User"
FOR EACH ROW EXECUTE FUNCTION deleted_account_restore_guard();

CREATE TABLE "AccountDeletionReceipt" (
  "userId" TEXT PRIMARY KEY, "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AccountDeletionReceipt_expiresAt_idx" ON "AccountDeletionReceipt"("expiresAt");

-- Legacy tables omit User foreign keys. Validate NEW writes and take a key-share
-- lock so account deletion waits for them, or they fail after deletion commits.
-- Existing rows are left intact; orphan remediation is a separate migration task.
CREATE FUNCTION account_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text;
BEGIN
  owner_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM "User" WHERE "id" = owner_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account no longer exists' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "UserHealthProfile_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserHealthProfile" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserHealthCondition_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserHealthCondition" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserAllergy_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserAllergy" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "WeightEntry_userId_account_guard" BEFORE INSERT OR UPDATE ON "WeightEntry" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "DailySteps_userId_account_guard" BEFORE INSERT OR UPDATE ON "DailySteps" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "WaterLog_userId_account_guard" BEFORE INSERT OR UPDATE ON "WaterLog" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "SleepLog_userId_account_guard" BEFORE INSERT OR UPDATE ON "SleepLog" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "FoodLog_userId_account_guard" BEFORE INSERT OR UPDATE ON "FoodLog" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "WorkoutSession_userId_account_guard" BEFORE INSERT OR UPDATE ON "WorkoutSession" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "Recommendation_userId_account_guard" BEFORE INSERT OR UPDATE ON "Recommendation" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserInsight_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserInsight" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserEvent_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserEvent" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserSupplement_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserSupplement" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "SupplementLog_userId_account_guard" BEFORE INSERT OR UPDATE ON "SupplementLog" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserIngredient_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserIngredient" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "MealRecommendation_userId_account_guard" BEFORE INSERT OR UPDATE ON "MealRecommendation" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "RecommendationViolation_userId_account_guard" BEFORE INSERT OR UPDATE ON "RecommendationViolation" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "SafetyAuditLog_userId_account_guard" BEFORE INSERT OR UPDATE ON "SafetyAuditLog" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "SupplementSchedule_userId_account_guard" BEFORE INSERT OR UPDATE ON "SupplementSchedule" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "DailyCoachingMessage_userId_account_guard" BEFORE INSERT OR UPDATE ON "DailyCoachingMessage" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserRole_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserRole" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "TrainerProfile_userId_account_guard" BEFORE INSERT OR UPDATE ON "TrainerProfile" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "TrainerClient_clientId_account_guard" BEFORE INSERT OR UPDATE ON "TrainerClient" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('clientId');
CREATE TRIGGER "TrainerDropForm_clientId_account_guard" BEFORE INSERT OR UPDATE ON "TrainerDropForm" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('clientId');
CREATE TRIGGER "TrainerWaitlist_userId_account_guard" BEFORE INSERT OR UPDATE ON "TrainerWaitlist" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "NutritionistProfile_userId_account_guard" BEFORE INSERT OR UPDATE ON "NutritionistProfile" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "NutritionistClient_clientId_account_guard" BEFORE INSERT OR UPDATE ON "NutritionistClient" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('clientId');
CREATE TRIGGER "CoachNote_clientId_account_guard" BEFORE INSERT OR UPDATE ON "CoachNote" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('clientId');
CREATE TRIGGER "CoachNote_coachId_account_guard" BEFORE INSERT OR UPDATE ON "CoachNote" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('coachId');
CREATE TRIGGER "WorkoutPlan_clientId_account_guard" BEFORE INSERT OR UPDATE ON "WorkoutPlan" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('clientId');
CREATE TRIGGER "MealPlan_clientId_account_guard" BEFORE INSERT OR UPDATE ON "MealPlan" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('clientId');
CREATE TRIGGER "CreatorProfile_userId_account_guard" BEFORE INSERT OR UPDATE ON "CreatorProfile" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "MacroGoal_userId_account_guard" BEFORE INSERT OR UPDATE ON "MacroGoal" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "DailyMacroScore_userId_account_guard" BEFORE INSERT OR UPDATE ON "DailyMacroScore" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "HealthScore_userId_account_guard" BEFORE INSERT OR UPDATE ON "HealthScore" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "UserPlanningPreferences_userId_account_guard" BEFORE INSERT OR UPDATE ON "UserPlanningPreferences" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "FoodPreference_userId_account_guard" BEFORE INSERT OR UPDATE ON "FoodPreference" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "WeeklyNutritionPlan_userId_account_guard" BEFORE INSERT OR UPDATE ON "WeeklyNutritionPlan" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "FoodInventory_userId_account_guard" BEFORE INSERT OR UPDATE ON "FoodInventory" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "DietAdherenceScore_userId_account_guard" BEFORE INSERT OR UPDATE ON "DietAdherenceScore" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "CalorieAdjustmentHistory_userId_account_guard" BEFORE INSERT OR UPDATE ON "CalorieAdjustmentHistory" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "WeeklyReview_userId_account_guard" BEFORE INSERT OR UPDATE ON "WeeklyReview" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "Notification_userId_account_guard" BEFORE INSERT OR UPDATE ON "Notification" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "ScannedLabel_userId_account_guard" BEFORE INSERT OR UPDATE ON "ScannedLabel" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "AuthSession_userId_account_guard" BEFORE INSERT OR UPDATE ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "ApiUsage_userId_account_guard" BEFORE INSERT OR UPDATE ON "ApiUsage" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');
CREATE TRIGGER "AuthAction_userId_account_guard" BEFORE INSERT OR UPDATE ON "AuthAction" FOR EACH ROW EXECUTE FUNCTION account_owner_guard('userId');

CREATE FUNCTION deleted_account_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AccountDeletionReceipt" WHERE strpos(to_jsonb(NEW)::text, "userId") > 0) THEN
    RAISE EXCEPTION 'Audit subject was deleted' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AuditLog_deleted_account_guard" BEFORE INSERT OR UPDATE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION deleted_account_audit_guard();

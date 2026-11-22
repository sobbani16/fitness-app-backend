-- Action feedback for the health-priorities action loop (dismissal suppression + verdicts)
CREATE TABLE "ActionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActionFeedback_userId_actionKey_createdAt_idx" ON "ActionFeedback"("userId", "actionKey", "createdAt");

-- CreateTable
CREATE TABLE "VoiceCommand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "createdEntities" JSONB NOT NULL,
    "result" JSONB,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceCommand_userId_createdAt_idx" ON "VoiceCommand"("userId", "createdAt");

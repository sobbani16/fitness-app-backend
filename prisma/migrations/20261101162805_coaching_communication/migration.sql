-- CreateTable
CREATE TABLE "CoachingGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'coaching',
    "trainerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachingGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupReadCursor" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupReadCursor_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "MessageReport" (
    "id" TEXT NOT NULL,
    "messageKind" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerDocument" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'education',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerDocumentShare" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "relationId" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerDocumentShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSession" (
    "id" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "purpose" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "recordingRequested" BOOLEAN NOT NULL DEFAULT false,
    "recordingStartedAt" TIMESTAMP(3),
    "recordingEndedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingConsent" (
    "id" TEXT NOT NULL,
    "videoSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSessionSummary" (
    "id" TEXT NOT NULL,
    "videoSessionId" TEXT NOT NULL,
    "memberSummary" TEXT,
    "actionItems" JSONB,
    "privateNotes" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSessionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachingGroup_trainerId_status_idx" ON "CoachingGroup"("trainerId", "status");

-- CreateIndex
CREATE INDEX "CoachingGroupMember_userId_status_idx" ON "CoachingGroupMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingGroupMember_groupId_userId_key" ON "CoachingGroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "GroupMessage_groupId_id_idx" ON "GroupMessage"("groupId", "id");

-- CreateIndex
CREATE INDEX "MessageReport_status_createdAt_idx" ON "MessageReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrainerDocument_trainerId_status_idx" ON "TrainerDocument"("trainerId", "status");

-- CreateIndex
CREATE INDEX "TrainerDocumentShare_relationId_idx" ON "TrainerDocumentShare"("relationId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerDocumentShare_documentId_relationId_groupId_key" ON "TrainerDocumentShare"("documentId", "relationId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSession_roomName_key" ON "VideoSession"("roomName");

-- CreateIndex
CREATE INDEX "VideoSession_relationId_scheduledStart_idx" ON "VideoSession"("relationId", "scheduledStart");

-- CreateIndex
CREATE INDEX "VideoSession_status_idx" ON "VideoSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingConsent_videoSessionId_userId_key" ON "RecordingConsent"("videoSessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSessionSummary_videoSessionId_key" ON "VideoSessionSummary"("videoSessionId");

-- AddForeignKey
ALTER TABLE "CoachingGroup" ADD CONSTRAINT "CoachingGroup_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingGroupMember" ADD CONSTRAINT "CoachingGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CoachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CoachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupReadCursor" ADD CONSTRAINT "GroupReadCursor_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CoachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerDocument" ADD CONSTRAINT "TrainerDocument_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerDocumentShare" ADD CONSTRAINT "TrainerDocumentShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TrainerDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerDocumentShare" ADD CONSTRAINT "TrainerDocumentShare_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerDocumentShare" ADD CONSTRAINT "TrainerDocumentShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CoachingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSession" ADD CONSTRAINT "VideoSession_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "TrainerClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsent" ADD CONSTRAINT "RecordingConsent_videoSessionId_fkey" FOREIGN KEY ("videoSessionId") REFERENCES "VideoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSessionSummary" ADD CONSTRAINT "VideoSessionSummary_videoSessionId_fkey" FOREIGN KEY ("videoSessionId") REFERENCES "VideoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

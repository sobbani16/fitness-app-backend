-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" JSONB,
    "journal" TEXT,
    "year" INTEGER,
    "doi" TEXT,
    "pmid" TEXT,
    "url" TEXT,
    "studyType" TEXT,
    "population" TEXT,
    "intervention" TEXT,
    "comparator" TEXT,
    "outcomes" TEXT,
    "resultsSummary" TEXT,
    "limitations" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "currentRevisionId" TEXT,
    "approvedRevisionId" TEXT,
    "publishedRevisionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticleRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "shortVerdict" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "takeaway" TEXT,
    "appliesTo" TEXT,
    "exceptions" TEXT,
    "uncertainty" TEXT,
    "certainty" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "certaintyRationale" TEXT,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "immutable" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleEvidence" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "supports" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArticleEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleReview" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "feedback" JSONB,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerProfile" (
    "userId" TEXT NOT NULL,
    "expertise" JSONB NOT NULL DEFAULT '[]',
    "qualifications" TEXT,
    "conflicts" TEXT,
    "clinical" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "EditorialSchedule" (
    "id" TEXT NOT NULL,
    "publishKey" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "blockedReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationEvent" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT,
    "articleId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'weekly',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFAQ" (
    "id" TEXT NOT NULL,
    "canonicalQuestion" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "shortAnswer" TEXT NOT NULL,
    "detail" TEXT,
    "topicTags" JSONB NOT NULL DEFAULT '[]',
    "articleId" TEXT,
    "sourceKeys" JSONB NOT NULL DEFAULT '[]',
    "certainty" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "language" TEXT NOT NULL DEFAULT 'en',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastReviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeFAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSavedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSavedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeQuestionSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeQuestionSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCorrection" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdById" TEXT NOT NULL,
    "resolvedRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ContentCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipModule" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MembershipModule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MembershipPackage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "modules" JSONB NOT NULL DEFAULT '[]',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "storeIds" JSONB NOT NULL DEFAULT '{}',
    "displayCopy" JSONB,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "packageKey" TEXT,
    "purchaseRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "packageKey" TEXT,
    "event" TEXT NOT NULL,
    "payload" JSONB,
    "providerEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "EntitlementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingPreference" (
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'self_guided',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_key_key" ON "ResearchSource"("key");

-- CreateIndex
CREATE INDEX "ResearchSource_status_idx" ON "ResearchSource"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_slug_key" ON "KnowledgeArticle"("slug");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_status_publishedAt_idx" ON "KnowledgeArticle"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_category_status_idx" ON "KnowledgeArticle"("category", "status");

-- CreateIndex
CREATE INDEX "KnowledgeArticleRevision_articleId_idx" ON "KnowledgeArticleRevision"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticleRevision_articleId_version_key" ON "KnowledgeArticleRevision"("articleId", "version");

-- CreateIndex
CREATE INDEX "ArticleEvidence_sourceId_idx" ON "ArticleEvidence"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleEvidence_revisionId_sourceId_key" ON "ArticleEvidence"("revisionId", "sourceId");

-- CreateIndex
CREATE INDEX "ArticleReview_articleId_createdAt_idx" ON "ArticleReview"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "ArticleReview_reviewerId_createdAt_idx" ON "ArticleReview"("reviewerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialSchedule_publishKey_key" ON "EditorialSchedule"("publishKey");

-- CreateIndex
CREATE INDEX "EditorialSchedule_status_scheduledFor_idx" ON "EditorialSchedule"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationEvent_scheduleId_key" ON "PublicationEvent"("scheduleId");

-- CreateIndex
CREATE INDEX "PublicationEvent_articleId_publishedAt_idx" ON "PublicationEvent"("articleId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeFAQ_canonicalQuestion_key" ON "KnowledgeFAQ"("canonicalQuestion");

-- CreateIndex
CREATE INDEX "KnowledgeFAQ_status_idx" ON "KnowledgeFAQ"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSavedItem_userId_articleId_key" ON "KnowledgeSavedItem"("userId", "articleId");

-- CreateIndex
CREATE INDEX "KnowledgeQuestionSuggestion_status_createdAt_idx" ON "KnowledgeQuestionSuggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentCorrection_status_idx" ON "ContentCorrection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPackage_key_key" ON "MembershipPackage"("key");

-- CreateIndex
CREATE INDEX "UserEntitlement_userId_moduleKey_status_idx" ON "UserEntitlement"("userId", "moduleKey", "status");

-- CreateIndex
CREATE INDEX "UserEntitlement_status_endsAt_idx" ON "UserEntitlement"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementEvent_providerEventId_key" ON "EntitlementEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "EntitlementEvent_userId_occurredAt_idx" ON "EntitlementEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "KnowledgeArticleRevision" ADD CONSTRAINT "KnowledgeArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleEvidence" ADD CONSTRAINT "ArticleEvidence_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KnowledgeArticleRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleEvidence" ADD CONSTRAINT "ArticleEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReview" ADD CONSTRAINT "ArticleReview_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReview" ADD CONSTRAINT "ArticleReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KnowledgeArticleRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSchedule" ADD CONSTRAINT "EditorialSchedule_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSchedule" ADD CONSTRAINT "EditorialSchedule_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KnowledgeArticleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationEvent" ADD CONSTRAINT "PublicationEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KnowledgeArticleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFAQ" ADD CONSTRAINT "KnowledgeFAQ_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSavedItem" ADD CONSTRAINT "KnowledgeSavedItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCorrection" ADD CONSTRAINT "ContentCorrection_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCorrection" ADD CONSTRAINT "ContentCorrection_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KnowledgeArticleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

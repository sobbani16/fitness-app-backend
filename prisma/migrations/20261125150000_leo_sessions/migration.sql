CREATE TABLE "LeoSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LeoSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeoMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "toolCallId" TEXT,
    "clientRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeoMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeoSession_userId_clientRef_key" ON "LeoSession"("userId", "clientRef");
CREATE INDEX "LeoSession_userId_idx" ON "LeoSession"("userId");
CREATE UNIQUE INDEX "LeoMessage_sessionId_clientRef_key" ON "LeoMessage"("sessionId", "clientRef");
CREATE INDEX "LeoMessage_sessionId_createdAt_idx" ON "LeoMessage"("sessionId", "createdAt");

ALTER TABLE "LeoSession" ADD CONSTRAINT "LeoSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeoMessage" ADD CONSTRAINT "LeoMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LeoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

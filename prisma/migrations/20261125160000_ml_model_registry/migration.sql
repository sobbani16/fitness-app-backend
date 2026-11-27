CREATE TABLE "MlModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "architecture" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "supportedExercises" TEXT[],
    "capabilities" JSONB NOT NULL,
    "evalResults" JSONB,
    "limitations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checksum" TEXT NOT NULL,
    "runtimeCompat" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "approvalRef" TEXT,
    "rollbackTargetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedAt" TIMESTAMP(3),

    CONSTRAINT "MlModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MlRolloutEvent" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlRolloutEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MlModel_name_version_key" ON "MlModel"("name", "version");
CREATE INDEX "MlModel_status_idx" ON "MlModel"("status");
CREATE INDEX "MlRolloutEvent_modelId_createdAt_idx" ON "MlRolloutEvent"("modelId", "createdAt");

ALTER TABLE "MlRolloutEvent" ADD CONSTRAINT "MlRolloutEvent_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MlModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

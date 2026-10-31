-- GST portal downloads: jobs for the office helper program, and GSTR-1 JSON
-- requests that the portal prepares later (see docs/GST_PORTAL_DOWNLOADS.md)

-- CreateEnum
CREATE TYPE "GstPortalJobStatus" AS ENUM ('QUEUED', 'CLAIMED', 'WAITING_LOGIN', 'RUNNING', 'DONE', 'PARTLY_DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GstPortalJob" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "months" TEXT[],
    "returns" TEXT[],
    "formats" TEXT[],
    "status" "GstPortalJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" VARCHAR(200),
    "log" JSONB,
    "filesSaved" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "helperName" VARCHAR(60),
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "requestedById" CHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstPortalJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstJsonRequest" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "jobId" CHAR(36),
    "returnType" VARCHAR(10) NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "parts" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedAt" TIMESTAMP(3),

    CONSTRAINT "GstJsonRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GstPortalJob_status_createdAt_idx" ON "GstPortalJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GstPortalJob_clientId_createdAt_idx" ON "GstPortalJob"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "GstJsonRequest_clientId_returnType_month_status_idx" ON "GstJsonRequest"("clientId", "returnType", "month", "status");

-- AddForeignKey
ALTER TABLE "GstPortalJob" ADD CONSTRAINT "GstPortalJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstPortalJob" ADD CONSTRAINT "GstPortalJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstJsonRequest" ADD CONSTRAINT "GstJsonRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstJsonRequest" ADD CONSTRAINT "GstJsonRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GstPortalJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- MVC Control Centre (docs/CONTROL_CENTRE.md): desktop software at clients pulls rules
-- published by Admin and sends a daily report. New tables only; nothing existing changes.

-- CreateTable
CREATE TABLE "DeskClient" (
    "id" CHAR(36) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "clientId" CHAR(36),
    "keyHash" CHAR(64) NOT NULL,
    "keyHint" VARCHAR(8) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expectReports" BOOLEAN NOT NULL DEFAULT true,
    "lastReportDate" DATE,
    "lastReportAt" TIMESTAMP(3),
    "appVersion" VARCHAR(20),
    "lastAlertDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeskClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskRule" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "label" VARCHAR(120),
    "unit" VARCHAR(40),
    "notes" TEXT,
    "clientCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "publishedBy" VARCHAR(50) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskDailyReport" (
    "id" CHAR(36) NOT NULL,
    "deskClientId" CHAR(36) NOT NULL,
    "reportDate" DATE NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appVersion" VARCHAR(20),
    "pc" VARCHAR(60),
    "sentBy" VARCHAR(60),
    "summary" JSONB NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DeskDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskEvent" (
    "id" SERIAL NOT NULL,
    "deskClientId" CHAR(36),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" VARCHAR(30) NOT NULL,
    "detail" TEXT,

    CONSTRAINT "DeskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeskClient_code_key" ON "DeskClient"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DeskClient_keyHash_key" ON "DeskClient"("keyHash");

-- CreateIndex
CREATE INDEX "DeskClient_clientId_idx" ON "DeskClient"("clientId");

-- CreateIndex
CREATE INDEX "DeskRule_key_effectiveFrom_idx" ON "DeskRule"("key", "effectiveFrom");

-- CreateIndex
CREATE INDEX "DeskDailyReport_reportDate_idx" ON "DeskDailyReport"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeskDailyReport_deskClientId_reportDate_key" ON "DeskDailyReport"("deskClientId", "reportDate");

-- CreateIndex
CREATE INDEX "DeskEvent_deskClientId_at_idx" ON "DeskEvent"("deskClientId", "at" DESC);

-- AddForeignKey
ALTER TABLE "DeskClient" ADD CONSTRAINT "DeskClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskDailyReport" ADD CONSTRAINT "DeskDailyReport_deskClientId_fkey" FOREIGN KEY ("deskClientId") REFERENCES "DeskClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskEvent" ADD CONSTRAINT "DeskEvent_deskClientId_fkey" FOREIGN KEY ("deskClientId") REFERENCES "DeskClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

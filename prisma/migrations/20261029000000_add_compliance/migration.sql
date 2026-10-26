-- CreateEnum
CREATE TYPE "ComplianceKind" AS ENUM ('GSTR1', 'GSTR3B', 'TDS_PAYMENT', 'TDS_RETURN', 'GENERIC');

-- CreateEnum
CREATE TYPE "ComplianceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('pending', 'data_received', 'filed', 'completed', 'not_required');

-- CreateEnum
CREATE TYPE "CertificateRule" AS ENUM ('NONE', 'EVERY_QUARTER', 'Q4_ONLY');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('RCM', 'TDS');

-- CreateEnum
CREATE TYPE "ObligationLineStatus" AS ENUM ('pending', 'confirmed', 'skipped');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "ComplianceDocKind" AS ENUM ('RETURN_PDF', 'RETURN_JSON', 'GSTR1A_PDF', 'GSTR1A_JSON', 'CHALLAN', 'CERTIFICATE', 'OTHER');

-- CreateTable
CREATE TABLE "ComplianceWorkType" (
    "id" CHAR(36) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "ComplianceKind" NOT NULL DEFAULT 'GENERIC',
    "frequency" "ComplianceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "allowQuarterly" BOOLEAN NOT NULL DEFAULT false,
    "company" "Company" NOT NULL DEFAULT 'MVC',
    "dueDay" INTEGER NOT NULL,
    "dueMonthOffset" INTEGER NOT NULL DEFAULT 1,
    "quarterlyDueDay" INTEGER,
    "quarterlyDueMonthOffset" INTEGER,
    "dueExceptions" JSONB,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "returnType" VARCHAR(5),
    "certificateRule" "CertificateRule" NOT NULL DEFAULT 'NONE',
    "requirePdf" BOOLEAN NOT NULL DEFAULT false,
    "requireJson" BOOLEAN NOT NULL DEFAULT false,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "defaultFeeNil" DECIMAL(12,2),
    "defaultFeeNonNil" DECIMAL(12,2),
    "reminderSubject" VARCHAR(150) NOT NULL,
    "reminderMessage" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceWorkType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceTeamMember" (
    "id" CHAR(36) NOT NULL,
    "workTypeId" CHAR(36) NOT NULL,
    "userId" CHAR(36) NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toDate" TIMESTAMP(3),

    CONSTRAINT "ComplianceTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCompliance" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "workTypeId" CHAR(36) NOT NULL,
    "frequency" "ComplianceFrequency" NOT NULL,
    "previousFrequency" "ComplianceFrequency",
    "frequencyFrom" DATE,
    "startPeriod" DATE NOT NULL,
    "endPeriod" DATE,
    "feeNil" DECIMAL(12,2),
    "feeNonNil" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceItem" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "workTypeId" CHAR(36) NOT NULL,
    "frequency" "ComplianceFrequency" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'pending',
    "historical" BOOLEAN NOT NULL DEFAULT false,
    "dataReceivedAt" TIMESTAMP(3),
    "filedAt" DATE,
    "arn" VARCHAR(50),
    "isNil" BOOLEAN,
    "taxPayable" DECIMAL(14,2),
    "figures" JSONB,
    "gstr1aFiled" BOOLEAN NOT NULL DEFAULT false,
    "gstr1aFiledAt" DATE,
    "gstr1aArn" VARCHAR(50),
    "noTds" BOOLEAN NOT NULL DEFAULT false,
    "certRequestedAt" DATE,
    "certRequestNo" VARCHAR(50),
    "certEmailedAt" TIMESTAMP(3),
    "certEmailedTo" VARCHAR(400),
    "completedAt" TIMESTAMP(3),
    "fee" DECIMAL(12,2),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "billId" CHAR(36),
    "updatedById" CHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvent" (
    "id" CHAR(36) NOT NULL,
    "itemId" CHAR(36) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "remark" TEXT,
    "userId" CHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "itemId" CHAR(36),
    "kind" "ComplianceDocKind" NOT NULL,
    "fileName" VARCHAR(150) NOT NULL,
    "contentType" VARCHAR(80) NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "gzipped" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" CHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientObligation" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36) NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "payee" VARCHAR(100) NOT NULL,
    "fixedAmount" DECIMAL(14,2),
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "fromMonth" DATE NOT NULL,
    "toMonth" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceObligationLine" (
    "id" CHAR(36) NOT NULL,
    "itemId" CHAR(36) NOT NULL,
    "obligationId" CHAR(36) NOT NULL,
    "baseAmount" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "status" "ObligationLineStatus" NOT NULL DEFAULT 'pending',
    "note" VARCHAR(300),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceObligationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsChallan" (
    "id" CHAR(36) NOT NULL,
    "itemId" CHAR(36) NOT NULL,
    "section" VARCHAR(10) NOT NULL,
    "bsrCode" VARCHAR(7),
    "challanDate" DATE NOT NULL,
    "serialNo" VARCHAR(10),
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceReminder" (
    "id" CHAR(36) NOT NULL,
    "itemId" CHAR(36) NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "sentTo" VARCHAR(400) NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "sentById" CHAR(36),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceNote" (
    "id" CHAR(36) NOT NULL,
    "clientId" CHAR(36),
    "itemId" CHAR(36),
    "body" TEXT NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'claude',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceWorkType_name_key" ON "ComplianceWorkType"("name");

-- CreateIndex
CREATE INDEX "ComplianceTeamMember_workTypeId_toDate_idx" ON "ComplianceTeamMember"("workTypeId", "toDate");

-- CreateIndex
CREATE INDEX "ComplianceTeamMember_userId_idx" ON "ComplianceTeamMember"("userId");

-- CreateIndex
CREATE INDEX "ClientCompliance_workTypeId_active_idx" ON "ClientCompliance"("workTypeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCompliance_clientId_workTypeId_key" ON "ClientCompliance"("clientId", "workTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceItem_billId_key" ON "ComplianceItem"("billId");

-- CreateIndex
CREATE INDEX "ComplianceItem_workTypeId_periodEnd_idx" ON "ComplianceItem"("workTypeId", "periodEnd");

-- CreateIndex
CREATE INDEX "ComplianceItem_status_dueDate_idx" ON "ComplianceItem"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceItem_clientId_workTypeId_periodStart_key" ON "ComplianceItem"("clientId", "workTypeId", "periodStart");

-- CreateIndex
CREATE INDEX "ComplianceEvent_itemId_idx" ON "ComplianceEvent"("itemId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_clientId_createdAt_idx" ON "ComplianceDocument"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceDocument_itemId_idx" ON "ComplianceDocument"("itemId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_storageKey_idx" ON "ComplianceDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ClientObligation_clientId_kind_idx" ON "ClientObligation"("clientId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligationLine_itemId_obligationId_key" ON "ComplianceObligationLine"("itemId", "obligationId");

-- CreateIndex
CREATE INDEX "TdsChallan_itemId_idx" ON "TdsChallan"("itemId");

-- CreateIndex
CREATE INDEX "ComplianceReminder_itemId_idx" ON "ComplianceReminder"("itemId");

-- CreateIndex
CREATE INDEX "ComplianceReminder_channel_sentAt_idx" ON "ComplianceReminder"("channel", "sentAt");

-- CreateIndex
CREATE INDEX "ComplianceNote_createdAt_idx" ON "ComplianceNote"("createdAt");

-- AddForeignKey
ALTER TABLE "ComplianceTeamMember" ADD CONSTRAINT "ComplianceTeamMember_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "ComplianceWorkType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceTeamMember" ADD CONSTRAINT "ComplianceTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCompliance" ADD CONSTRAINT "ClientCompliance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCompliance" ADD CONSTRAINT "ClientCompliance_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "ComplianceWorkType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "ComplianceWorkType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvent" ADD CONSTRAINT "ComplianceEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvent" ADD CONSTRAINT "ComplianceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientObligation" ADD CONSTRAINT "ClientObligation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationLine" ADD CONSTRAINT "ComplianceObligationLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationLine" ADD CONSTRAINT "ComplianceObligationLine_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "ClientObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReminder" ADD CONSTRAINT "ComplianceReminder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReminder" ADD CONSTRAINT "ComplianceReminder_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceNote" ADD CONSTRAINT "ComplianceNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceNote" ADD CONSTRAINT "ComplianceNote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplianceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Default work types. Admin can change dates, fees, teams and messages in
-- Compliance → Setup, and add more. {client}, {work}, {period}, {due},
-- {taxPayable} and {firm} in the messages are filled in for each client.
INSERT INTO "ComplianceWorkType" ("id", "name", "kind", "frequency", "allowQuarterly", "dueDay", "dueMonthOffset", "quarterlyDueDay", "quarterlyDueMonthOffset", "dueExceptions", "leadDays", "returnType", "certificateRule", "requirePdf", "requireJson", "billable", "reminderSubject", "reminderMessage", "sortOrder", "system", "updatedAt") VALUES
    (gen_random_uuid()::text, 'GSTR-1', 'GSTR1', 'MONTHLY', true, 11, 1, 13, 1, NULL, 7, NULL, 'NONE', true, true, false,
     '{work} for {period}: data required',
     'Dear {client}, please share your sales data for {work} for {period}. The due date is {due}. – {firm}', 10, true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'GSTR-3B', 'GSTR3B', 'MONTHLY', true, 20, 1, 22, 1, NULL, 7, NULL, 'NONE', true, false, true,
     '{work} for {period}: data required',
     'Dear {client}, please share your purchase and expense data for {work} for {period}. The due date is {due}.{taxPayable} – {firm}', 20, true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TDS Payment', 'TDS_PAYMENT', 'MONTHLY', false, 7, 1, NULL, NULL, '{"3": {"day": 30, "offset": 1}}', 5, NULL, 'NONE', false, false, false,
     'TDS for {period}: details required',
     'Dear {client}, please share the TDS details for {period} (salary, rent, professional fees, contractors etc.). The TDS has to be paid by {due}.{taxPayable} – {firm}', 30, true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TDS Return 24Q', 'TDS_RETURN', 'QUARTERLY', false, 31, 1, NULL, NULL, '{"3": {"day": 31, "offset": 2}}', 7, '24Q', 'Q4_ONLY', false, false, true,
     '{work} for {period}: details required',
     'Dear {client}, please share the salary and deductee details for {work} for {period}. The due date is {due}. – {firm}', 40, true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TDS Return 26Q', 'TDS_RETURN', 'QUARTERLY', false, 31, 1, NULL, NULL, '{"3": {"day": 31, "offset": 2}}', 7, '26Q', 'EVERY_QUARTER', false, false, true,
     '{work} for {period}: details required',
     'Dear {client}, please share the deductee details (PAN and amounts) for {work} for {period}. The due date is {due}. – {firm}', 50, true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Advance Tax', 'GENERIC', 'QUARTERLY', false, 15, 0, NULL, NULL, NULL, 15, NULL, 'NONE', false, false, false,
     '{work} instalment due on {due}',
     'Dear {client}, the {work} instalment for {period} is due on {due}. Please share your income details so we can work it out.{taxPayable} – {firm}', 60, false, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Income Tax Return', 'GENERIC', 'YEARLY', false, 31, 4, NULL, NULL, NULL, 30, NULL, 'NONE', true, false, true,
     '{work} for {period}: documents required',
     'Dear {client}, please share your documents for the {work} for {period}. The due date is {due}. – {firm}', 70, false, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

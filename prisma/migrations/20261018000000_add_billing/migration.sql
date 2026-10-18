-- CreateEnum
CREATE TYPE "Company" AS ENUM ('MVC', 'BEDGE');

-- CreateEnum
CREATE TYPE "BillType" AS ENUM ('GST', 'NON_GST', 'BEDGE');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('draft', 'awaiting_amount', 'amount_entered', 'manager_approved', 'approved', 'cancelled', 'not_billable');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManageBedgeBilling" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "company" "Company" NOT NULL DEFAULT 'MVC';

-- CreateTable
CREATE TABLE "Bill" (
    "id" CHAR(36) NOT NULL,
    "company" "Company" NOT NULL,
    "type" "BillType",
    "status" "BillStatus" NOT NULL DEFAULT 'draft',
    "description" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "taskId" CHAR(36),
    "clientId" CHAR(36),
    "createdById" CHAR(36) NOT NULL,
    "amount" DECIMAL(12,2),
    "amountRequestedFromId" CHAR(36),
    "amountEnteredById" CHAR(36),
    "amountEnteredAt" TIMESTAMP(3),
    "financialYear" VARCHAR(7),
    "sequence" INTEGER,
    "billNumber" VARCHAR(30),
    "billDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillEvent" (
    "id" CHAR(36) NOT NULL,
    "billId" CHAR(36) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "remark" TEXT,
    "userId" CHAR(36) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillSeries" (
    "type" "BillType" NOT NULL,
    "financialYear" VARCHAR(7) NOT NULL,
    "nextNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillSeries_pkey" PRIMARY KEY ("type")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bill_taskId_key" ON "Bill"("taskId");

-- CreateIndex
CREATE INDEX "Bill_company_status_idx" ON "Bill"("company", "status");

-- CreateIndex
CREATE INDEX "Bill_amountRequestedFromId_status_idx" ON "Bill"("amountRequestedFromId", "status");

-- CreateIndex
CREATE INDEX "Bill_createdById_idx" ON "Bill"("createdById");

-- CreateIndex
CREATE INDEX "Bill_clientId_idx" ON "Bill"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_type_financialYear_sequence_key" ON "Bill"("type", "financialYear", "sequence");

-- CreateIndex
CREATE INDEX "BillEvent_billId_createdAt_idx" ON "BillEvent"("billId", "createdAt");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_amountRequestedFromId_fkey" FOREIGN KEY ("amountRequestedFromId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_amountEnteredById_fkey" FOREIGN KEY ("amountEnteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillEvent" ADD CONSTRAINT "BillEvent_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillEvent" ADD CONSTRAINT "BillEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Continue the bill series from the last numbers issued by hand
-- (GST 26-27/0217, Non-GST 2026-27/26985, B Edge BE/26149).
-- Admin can change the next numbers in Settings on go-live day.
INSERT INTO "BillSeries" ("type", "financialYear", "nextNumber", "updatedAt") VALUES
    ('GST', '2026-27', 218, CURRENT_TIMESTAMP),
    ('NON_GST', '2026-27', 26986, CURRENT_TIMESTAMP),
    ('BEDGE', '2026-27', 26150, CURRENT_TIMESTAMP);

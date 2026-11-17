-- GST return number series (docs/BILLING.md) and task kinds: a completed GST
-- registration task creates the GST bank account task (docs/TASKS.md)

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('GST_REGISTRATION', 'GST_BANK_ACCOUNT');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "gstReturnFinancialYear" VARCHAR(7),
ADD COLUMN     "gstReturnMonth" DATE,
ADD COLUMN     "gstReturnNumber" VARCHAR(30),
ADD COLUMN     "gstReturnPushedAt" TIMESTAMP(3),
ADD COLUMN     "gstReturnPushedById" CHAR(36),
ADD COLUMN     "gstReturnSequence" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kind" "TaskKind",
ADD COLUMN     "parentTaskId" CHAR(36);

-- CreateTable
CREATE TABLE "GstReturnSeries" (
    "financialYear" VARCHAR(7) NOT NULL,
    "nextNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstReturnSeries_pkey" PRIMARY KEY ("financialYear")
);

-- CreateIndex
CREATE INDEX "Bill_gstReturnMonth_idx" ON "Bill"("gstReturnMonth");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_gstReturnFinancialYear_gstReturnSequence_key" ON "Bill"("gstReturnFinancialYear", "gstReturnSequence");

-- CreateIndex
CREATE UNIQUE INDEX "Task_parentTaskId_kind_key" ON "Task"("parentTaskId", "kind");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_gstReturnPushedById_fkey" FOREIGN KEY ("gstReturnPushedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Open tasks that are GST registrations by their title become that kind, so
-- completing them creates the bank account task
UPDATE "Task" SET "kind" = 'GST_REGISTRATION'
WHERE "kind" IS NULL
  AND "status" IN ('pending', 'in_progress', 'review')
  AND "title" ILIKE '%gst%regist%';

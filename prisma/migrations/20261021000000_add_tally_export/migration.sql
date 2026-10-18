-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "tallyLedgerName" VARCHAR(100);

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "tallyExportId" CHAR(36),
ADD COLUMN     "tallyExportedAt" TIMESTAMP(3),
ADD COLUMN     "tallyNeedsUpdate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BillingEntity" ADD COLUMN     "tallyCgstLedger" VARCHAR(100),
ADD COLUMN     "tallyCompany" VARCHAR(100),
ADD COLUMN     "tallyIgstLedger" VARCHAR(100),
ADD COLUMN     "tallySalesLedger" VARCHAR(100),
ADD COLUMN     "tallySgstLedger" VARCHAR(100),
ADD COLUMN     "tallyVoucherType" VARCHAR(50);

-- CreateTable
CREATE TABLE "TallyExport" (
    "id" CHAR(36) NOT NULL,
    "type" "BillType" NOT NULL,
    "xml" TEXT NOT NULL,
    "newCount" INTEGER NOT NULL,
    "updateCount" INTEGER NOT NULL,
    "createdById" CHAR(36) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TallyExport_type_createdAt_idx" ON "TallyExport"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tallyExportId_fkey" FOREIGN KEY ("tallyExportId") REFERENCES "TallyExport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyExport" ADD CONSTRAINT "TallyExport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


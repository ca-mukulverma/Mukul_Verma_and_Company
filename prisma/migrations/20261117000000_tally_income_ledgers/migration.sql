-- Income ledger per bill for Tally (docs/TALLY_DIRECT_IMPORT.md): the list of
-- income ledgers (services) in Tally, the ledger and line description on each
-- bill, and the default ledger of each compliance work type.

-- CreateTable
CREATE TABLE "TallyIncomeLedger" (
    "id" CHAR(36) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "groupName" VARCHAR(100),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyIncomeLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TallyIncomeLedger_name_key" ON "TallyIncomeLedger"("name");

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "incomeLedgerId" CHAR(36),
ADD COLUMN "tallyLineDescription" VARCHAR(250);

-- CreateIndex
CREATE INDEX "Bill_incomeLedgerId_idx" ON "Bill"("incomeLedgerId");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_incomeLedgerId_fkey" FOREIGN KEY ("incomeLedgerId") REFERENCES "TallyIncomeLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ComplianceWorkType" ADD COLUMN "incomeLedgerId" CHAR(36);

-- AddForeignKey
ALTER TABLE "ComplianceWorkType" ADD CONSTRAINT "ComplianceWorkType_incomeLedgerId_fkey" FOREIGN KEY ("incomeLedgerId") REFERENCES "TallyIncomeLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "connectorId" CHAR(36),
ADD COLUMN     "ownerIsResponsible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phones" JSONB,
ADD COLUMN     "responsibleEmail" VARCHAR(75),
ADD COLUMN     "responsibleName" VARCHAR(50),
ADD COLUMN     "responsiblePhone" VARCHAR(15),
ADD COLUMN     "tallyLedgerPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "connectorId" CHAR(36),
ADD COLUMN     "showGstin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tallyLedgerName" VARCHAR(100);

-- AlterTable
ALTER TABLE "ComplianceItem" ADD COLUMN     "checkedById" CHAR(36),
ADD COLUMN     "completedById" CHAR(36);

-- AlterTable
ALTER TABLE "ComplianceObligationLine" ADD COLUMN     "resolvedById" CHAR(36);

-- CreateTable
CREATE TABLE "Connector" (
    "id" CHAR(36) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(15),
    "email" VARCHAR(75),
    "tallyLedgerName" VARCHAR(100),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_connectorId_idx" ON "Client"("connectorId");

-- CreateIndex
CREATE INDEX "Bill_connectorId_idx" ON "Bill"("connectorId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationLine" ADD CONSTRAINT "ComplianceObligationLine_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing clients: today's phone becomes the owner's first number, used for
-- WhatsApp as before
UPDATE "Client"
SET "phones" = jsonb_build_array(jsonb_build_object('number', "phone", 'label', 'Owner', 'whatsapp', true))
WHERE "phone" IS NOT NULL AND btrim("phone") <> '';

-- Numbered bills keep the ledger they were posted to
UPDATE "Bill" AS b
SET "tallyLedgerName" = COALESCE(NULLIF(c."tallyLedgerName", ''), NULLIF(c."companyName", ''), c."contactPerson")
FROM "Client" AS c
WHERE b."clientId" = c."id" AND b."billNumber" IS NOT NULL;

-- When each bill reached its current stage: its latest history entry
UPDATE "Bill" AS b
SET "statusChangedAt" = COALESCE((SELECT MAX(e."createdAt") FROM "BillEvent" AS e WHERE e."billId" = b."id"), b."updatedAt");

-- Keeps "statusChangedAt" right however a bill is moved on (single updates,
-- batch approvals, raw SQL): it restarts when the stage changes or the bill is
-- sent to another person for the amount
CREATE OR REPLACE FUNCTION bill_stage_changed() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."amountRequestedFromId" IS DISTINCT FROM OLD."amountRequestedFromId" THEN
    NEW."statusChangedAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Bill_stage_changed"
BEFORE UPDATE ON "Bill"
FOR EACH ROW EXECUTE FUNCTION bill_stage_changed();

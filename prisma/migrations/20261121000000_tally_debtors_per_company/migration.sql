-- Debtors for each firm's Tally company: MVC and B Edge, each from its own
-- Tally PC (docs/TALLY_DEBTORS.md). What is already here is MVC's.

DROP INDEX "TallyDebtorLedger_nameKey_key";
DROP INDEX "TallyDebtorLedger_groupName_idx";
DROP INDEX "TallyLedgerEvent_ledgerName_at_idx";

ALTER TABLE "TallyDebtorSync" ADD COLUMN "entity" "Company" NOT NULL DEFAULT 'MVC';
ALTER TABLE "TallyDebtorSync" DROP CONSTRAINT "TallyDebtorSync_pkey";
ALTER TABLE "TallyDebtorSync" DROP COLUMN "id";
ALTER TABLE "TallyDebtorSync" ADD CONSTRAINT "TallyDebtorSync_pkey" PRIMARY KEY ("entity");
ALTER TABLE "TallyDebtorSync" ALTER COLUMN "entity" DROP DEFAULT;

ALTER TABLE "TallyDebtorLedger" ADD COLUMN "entity" "Company" NOT NULL DEFAULT 'MVC';
ALTER TABLE "TallyDebtorLedger" ALTER COLUMN "entity" DROP DEFAULT;

ALTER TABLE "TallyLedgerEvent" ADD COLUMN "entity" "Company" NOT NULL DEFAULT 'MVC';

CREATE INDEX "TallyDebtorLedger_nameKey_idx" ON "TallyDebtorLedger"("nameKey");
CREATE UNIQUE INDEX "TallyDebtorLedger_entity_nameKey_key" ON "TallyDebtorLedger"("entity", "nameKey");
CREATE INDEX "TallyLedgerEvent_entity_ledgerName_at_idx" ON "TallyLedgerEvent"("entity", "ledgerName", "at" DESC);

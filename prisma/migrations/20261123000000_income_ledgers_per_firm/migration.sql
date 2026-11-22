-- Income ledgers per firm (docs/TALLY_DIRECT_IMPORT.md, "Service → income
-- ledger"): MVC's ledgers for MVC bills, B Edge's for B Edge bills. Every
-- ledger so far is from Mukul Verma & Co., so it is MVC's.

DROP INDEX "TallyIncomeLedger_name_key";

ALTER TABLE "TallyIncomeLedger" ADD COLUMN "entity" "Company" NOT NULL DEFAULT 'MVC',
ADD COLUMN "inTally" BOOLEAN,
ADD COLUMN "tallySeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "TallyIncomeLedger_entity_name_key" ON "TallyIncomeLedger"("entity", "name");

-- A B Edge work type can't start its bills with an MVC ledger
UPDATE "ComplianceWorkType" SET "incomeLedgerId" = NULL
WHERE "company" = 'BEDGE' AND "incomeLedgerId" IS NOT NULL;

-- B Edge bills not yet in Tally with an MVC ledger: that ledger isn't in B
-- Edge's Tally, so the billing manager picks one of B Edge's (bills already
-- sent keep theirs)
UPDATE "Bill" SET "incomeLedgerId" = NULL
WHERE "company" = 'BEDGE' AND "tallyExportedAt" IS NULL AND "incomeLedgerId" IS NOT NULL;

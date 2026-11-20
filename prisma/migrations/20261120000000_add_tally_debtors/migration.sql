-- Debtors from Tally (docs/TALLY_DEBTORS.md)

ALTER TABLE "User" ADD COLUMN "canViewDebtors" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TallyDebtorSync" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "company" VARCHAR(100) NOT NULL,
    "keyHash" CHAR(64),
    "keyHint" VARCHAR(8),
    "connectedAt" TIMESTAMP(3),
    "connectedBy" VARCHAR(50),
    "rootGroup" VARCHAR(150),
    "groups" JSONB,
    "periodFrom" DATE,
    "periodTo" DATE,
    "readAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "trigger" VARCHAR(20),
    "ledgerCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyDebtorSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TallyDebtorSync_keyHash_key" ON "TallyDebtorSync"("keyHash");

CREATE TABLE "TallyDebtorLedger" (
    "id" CHAR(36) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "nameKey" VARCHAR(150) NOT NULL,
    "groupName" VARCHAR(150) NOT NULL,
    "opening" DECIMAL(14,2) NOT NULL,
    "closing" DECIMAL(14,2) NOT NULL,
    "lastReceiptDate" DATE,
    "lastReceiptAmt" DECIMAL(14,2),
    "entries" JSONB NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyDebtorLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TallyDebtorLedger_nameKey_key" ON "TallyDebtorLedger"("nameKey");
CREATE INDEX "TallyDebtorLedger_groupName_idx" ON "TallyDebtorLedger"("groupName");

CREATE TABLE "TallyLedgerEvent" (
    "id" SERIAL NOT NULL,
    "ledgerName" VARCHAR(150) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "dataAsOf" TIMESTAMP(3),
    "recipient" VARCHAR(30),
    "userId" CHAR(36) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyLedgerEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TallyLedgerEvent_ledgerName_at_idx" ON "TallyLedgerEvent"("ledgerName", "at" DESC);
CREATE INDEX "TallyLedgerEvent_at_idx" ON "TallyLedgerEvent"("at");

ALTER TABLE "TallyLedgerEvent" ADD CONSTRAINT "TallyLedgerEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

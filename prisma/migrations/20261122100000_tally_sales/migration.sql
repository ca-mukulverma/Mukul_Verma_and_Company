-- Sales from each firm's Tally (Admin's Sales page, docs/TALLY_DEBTORS.md)

-- AlterTable
ALTER TABLE "TallyDebtorSync" ADD COLUMN     "salesFrom" DATE,
ADD COLUMN     "salesGroups" JSONB,
ADD COLUMN     "salesLedgers" JSONB,
ADD COLUMN     "salesRoot" VARCHAR(150);

-- CreateTable
CREATE TABLE "TallySalesMonth" (
    "entity" "Company" NOT NULL,
    "month" CHAR(7) NOT NULL,
    "lines" JSONB NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallySalesMonth_pkey" PRIMARY KEY ("entity","month")
);


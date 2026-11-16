-- Why Tally refused a bill sent straight into it from the app
-- (docs/TALLY_DIRECT_IMPORT.md)

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "tallyError" TEXT,
ADD COLUMN "tallyErrorAt" TIMESTAMP(3);

-- Ledgers can now be emailed too: the recipient holds up to 5 email addresses
ALTER TABLE "TallyLedgerEvent" ALTER COLUMN "recipient" TYPE VARCHAR(400);

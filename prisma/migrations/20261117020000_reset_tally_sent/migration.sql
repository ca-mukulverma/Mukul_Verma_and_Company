-- No bill made in the app has been imported into Tally yet (confirmed by the
-- firm, 17 Nov 2026), although XML files were downloaded. Every numbered bill
-- goes back to "waiting for Tally", to be sent with Import into Tally:
-- approved bills as new vouchers; bills cancelled or reissued before they
-- were ever in Tally are not sent (docs/TALLY_DIRECT_IMPORT.md).
-- The downloaded files stay in the Tally tab's history.
UPDATE "Bill"
SET "tallyExportedAt" = NULL,
    "tallyNeedsUpdate" = false,
    "tallyExportId" = NULL,
    "tallyError" = NULL,
    "tallyErrorAt" = NULL
WHERE "tallyExportedAt" IS NOT NULL
   OR "tallyNeedsUpdate" = true
   OR "tallyExportId" IS NOT NULL;

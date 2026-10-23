-- New Tally files are stored gzipped; older ones stay as text until they are pruned
ALTER TABLE "TallyExport" ALTER COLUMN "xml" DROP NOT NULL,
ADD COLUMN     "xmlGzip" BYTEA;

-- Keep only the latest 10 files of each series (as many as the Tally tab
-- lists). Bills that pointed to a removed file keep their sent date.
DELETE FROM "TallyExport"
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "type" ORDER BY "createdAt" DESC) AS "rank"
        FROM "TallyExport"
    ) ranked
    WHERE "rank" > 10
);

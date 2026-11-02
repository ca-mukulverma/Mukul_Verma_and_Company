-- GST portal downloads are switched off for now (database cost while the
-- helper polls). The feature's code is kept on the feature/gst-portal-downloads
-- branch; re-adding it needs a new migration.

-- DropForeignKey
ALTER TABLE "GstPortalJob" DROP CONSTRAINT "GstPortalJob_clientId_fkey";

-- DropForeignKey
ALTER TABLE "GstPortalJob" DROP CONSTRAINT "GstPortalJob_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "GstJsonRequest" DROP CONSTRAINT "GstJsonRequest_clientId_fkey";

-- DropForeignKey
ALTER TABLE "GstJsonRequest" DROP CONSTRAINT "GstJsonRequest_jobId_fkey";

-- DropTable
DROP TABLE "GstPortalJob";

-- DropTable
DROP TABLE "GstJsonRequest";

-- DropEnum
DROP TYPE "GstPortalJobStatus";


-- "Helper last seen", shown by the removed screen
DELETE FROM "ComplianceSetting" WHERE "key" = 'gstHelperSeen';

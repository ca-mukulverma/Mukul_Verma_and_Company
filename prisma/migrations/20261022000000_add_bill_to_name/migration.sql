-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "billToAddress" TEXT,
ADD COLUMN     "billToGstin" VARCHAR(15),
ADD COLUMN     "billToName" VARCHAR(150);


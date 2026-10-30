-- Optional remark from the billing manager when sending a bill for the amount
ALTER TABLE "Bill" ADD COLUMN "amountRequestNote" TEXT;

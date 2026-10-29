-- Which Billing Lists (bill types) a partner with Billing List sees; empty = all
ALTER TABLE "User" ADD COLUMN "billingListTypes" "BillType"[] NOT NULL DEFAULT ARRAY[]::"BillType"[];

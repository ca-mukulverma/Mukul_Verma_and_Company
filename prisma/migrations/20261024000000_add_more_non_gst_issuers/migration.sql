-- Non-GST MVC bills can also be made out in the name of CA Harsh Verma or
-- Verma Law Associates. New enum values can't be used in the migration that
-- adds them, so their profiles and series are created in the next one.
ALTER TYPE "BillType" ADD VALUE 'NON_GST_HV' BEFORE 'BEDGE';
ALTER TYPE "BillType" ADD VALUE 'NON_GST_VLA' BEFORE 'BEDGE';

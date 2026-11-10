-- Client logins by portal: GST, Income tax, TDS (TRACES), TDS (Income tax,
-- the TAN login), PF, ESIC, MCA, or another named by its title

CREATE TYPE "CredentialKind" AS ENUM ('GST', 'INCOME_TAX', 'TDS_TRACES', 'TDS_INCOME_TAX', 'PF', 'ESIC', 'MCA', 'OTHER');

ALTER TABLE "Credential" ADD COLUMN "kind" "CredentialKind" NOT NULL DEFAULT 'OTHER';

-- Logins saved before: their portal from the title, as the app read it until
-- now (the GST portal login: "GST" but not the e-way bill / e-invoice one).
-- Anything else stays OTHER, under its own title.
UPDATE "Credential"
SET "kind" = (CASE
  WHEN "title" ~* 'gst' AND "title" !~* 'e[[:space:]-]*way|\mewb\M|e[[:space:]-]*invoice|\meinv|\mirp\M' THEN 'GST'
  WHEN "title" ~* 'traces' THEN 'TDS_TRACES'
  WHEN "title" ~* '\mtds\M|\mtan\M' THEN 'TDS_INCOME_TAX'
  WHEN "title" ~* 'income|\mitr\M|e-?filing|\mit\M' THEN 'INCOME_TAX'
  WHEN "title" ~* '\mepfo?\M|\mpf\M|provident' THEN 'PF'
  WHEN "title" ~* 'esic|\mesi\M' THEN 'ESIC'
  WHEN "title" ~* '\mmca\M|\mroc\M' THEN 'MCA'
  ELSE 'OTHER'
END)::"CredentialKind";

-- More formal wording for the default reminder texts. Only texts nobody has
-- edited are changed (Compliance → Setup keeps any text Admin wrote).
UPDATE "ComplianceWorkType" SET "reminderSubject" = 'Reminder: data required for {work} for {period}'
WHERE "reminderSubject" = '{work} for {period}: data required';

UPDATE "ComplianceWorkType" SET "reminderSubject" = 'Reminder: details required for {work} for {period}'
WHERE "reminderSubject" = '{work} for {period}: details required';

UPDATE "ComplianceWorkType" SET "reminderSubject" = 'Reminder: TDS details required for {period}'
WHERE "reminderSubject" = 'TDS for {period}: details required';

UPDATE "ComplianceWorkType" SET "reminderSubject" = 'Reminder: {work} instalment due on {due}'
WHERE "reminderSubject" = '{work} instalment due on {due}';

UPDATE "ComplianceWorkType" SET "reminderSubject" = 'Reminder: documents required for {work} for {period}'
WHERE "reminderSubject" = '{work} for {period}: documents required';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, kindly share your sales data for {work} for {period} at the earliest. The due date is {due}. – {firm}'
WHERE "reminderMessage" = 'Dear {client}, please share your sales data for {work} for {period}. The due date is {due}. – {firm}';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, kindly share your purchase and expense data for {work} for {period} at the earliest. The due date is {due}.{taxPayable} – {firm}'
WHERE "reminderMessage" = 'Dear {client}, please share your purchase and expense data for {work} for {period}. The due date is {due}.{taxPayable} – {firm}';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, kindly share the TDS details for {period} (salary, rent, professional fees, contractors etc.) at the earliest. The TDS is to be deposited by {due}.{taxPayable} – {firm}'
WHERE "reminderMessage" = 'Dear {client}, please share the TDS details for {period} (salary, rent, professional fees, contractors etc.). The TDS has to be paid by {due}.{taxPayable} – {firm}';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, kindly share the salary and deductee details for {work} for {period} at the earliest. The due date is {due}. – {firm}'
WHERE "reminderMessage" = 'Dear {client}, please share the salary and deductee details for {work} for {period}. The due date is {due}. – {firm}';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, kindly share the deductee details (PAN and amounts) for {work} for {period} at the earliest. The due date is {due}. – {firm}'
WHERE "reminderMessage" = 'Dear {client}, please share the deductee details (PAN and amounts) for {work} for {period}. The due date is {due}. – {firm}';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, the {work} instalment for {period} is due on {due}. Kindly share your income details so that we can compute the amount payable.{taxPayable} – {firm}'
WHERE "reminderMessage" = 'Dear {client}, the {work} instalment for {period} is due on {due}. Please share your income details so we can work it out.{taxPayable} – {firm}';

UPDATE "ComplianceWorkType" SET "reminderMessage" = 'Dear {client}, kindly share your documents for the {work} for {period} at the earliest. The due date is {due}. – {firm}'
WHERE "reminderMessage" = 'Dear {client}, please share your documents for the {work} for {period}. The due date is {due}. – {firm}';

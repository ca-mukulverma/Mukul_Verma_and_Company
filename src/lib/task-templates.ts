// Ready-made starting points for jobs the office does again and again. Picking
// one fills the title and a checklist in the description; everything can be
// changed before the task is created.

export interface TaskTemplate {
  id: string;
  label: string;
  title: string;
  priority: "low" | "medium" | "high";
  // Days from today for the due date
  dueInDays?: number;
  checklist: string[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "itr",
    label: "ITR filing",
    title: "ITR filing",
    priority: "medium",
    dueInDays: 7,
    checklist: [
      "Collect Form 16 / 16A, bank statements and interest certificates",
      "Download AIS, TIS and Form 26AS and match them",
      "Prepare the computation of income",
      "Share the computation with the client for approval",
      "File the return and e-verify",
      "Send the ITR-V and computation to the client",
    ],
  },
  {
    id: "gst-notice",
    label: "GST notice reply",
    title: "GST notice reply",
    priority: "high",
    dueInDays: 5,
    checklist: [
      "Download the notice and note the reply due date",
      "Collect the documents the notice asks for",
      "Reconcile the figures (GSTR-1, 3B, 2B) for the period",
      "Draft the reply and share it with the client",
      "File the reply on the portal and save the acknowledgement",
    ],
  },
  {
    id: "it-notice",
    label: "Income tax notice",
    title: "Income tax notice reply",
    priority: "high",
    dueInDays: 5,
    checklist: [
      "Download the notice from the e-filing portal and note the due date",
      "Collect the documents asked for",
      "Draft the reply and share it with the client",
      "Submit the reply and save the acknowledgement",
    ],
  },
  {
    id: "roc",
    label: "ROC filing",
    title: "ROC annual filing (AOC-4 / MGT-7)",
    priority: "medium",
    dueInDays: 14,
    checklist: [
      "Get the signed financial statements and board report",
      "Check the DSCs of the directors are valid",
      "Prepare AOC-4 and MGT-7 / MGT-7A",
      "Get the forms certified and signed",
      "File on the MCA portal and save the challans",
    ],
  },
  {
    id: "gst-registration",
    label: "GST registration",
    title: "New GST registration",
    priority: "medium",
    dueInDays: 7,
    checklist: [
      "Collect PAN, Aadhaar, photo, address proof and bank details",
      "Fill Part A and Part B on the portal",
      "Complete Aadhaar authentication",
      "Reply to any clarification asked",
      "Send the registration certificate to the client and add the GSTIN to the client record",
    ],
  },
  {
    id: "audit",
    label: "Tax audit",
    title: "Tax audit (3CA/3CB-3CD)",
    priority: "medium",
    dueInDays: 21,
    checklist: [
      "Get the books of accounts and trial balance",
      "Verify the clauses of Form 3CD",
      "Discuss the observations with the client",
      "Upload the audit report and get it accepted by the client",
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    title: "Accounting / bookkeeping",
    priority: "low",
    dueInDays: 10,
    checklist: [
      "Collect bank statements, sales and purchase bills",
      "Enter the vouchers in Tally",
      "Reconcile the bank accounts",
      "Share the ledgers with the client",
    ],
  },
];

export function templateDescription(template: TaskTemplate) {
  return template.checklist.map((step) => `☐ ${step}`).join("\n");
}

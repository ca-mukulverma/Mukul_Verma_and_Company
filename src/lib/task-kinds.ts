// Kinds of task (docs/TASKS.md). Safe to import in the browser: no database
// access here. Most tasks have no kind; a kind makes the app do something
// when the task is completed.

export const TASK_KINDS = ["GST_REGISTRATION", "GST_BANK_ACCOUNT"] as const;
export type TaskKindValue = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKindValue, string> = {
  GST_REGISTRATION: "GST registration",
  GST_BANK_ACCOUNT: "Add bank account in GST",
};

// The kinds a person can pick when creating or editing a task. The bank
// account task is only ever created by the app.
export const PICKABLE_TASK_KINDS = ["GST_REGISTRATION"] as const satisfies readonly TaskKindValue[];

// Days the bank account must be added within after GST registration
// (Rule 10A: 30 days, or before the first GSTR-1 / IFF if that is earlier)
export const GST_BANK_ACCOUNT_DAYS = 30;

// A compulsory task: nobody can ask for its deletion, and Admin closes it as
// not needed only with a reason
export function isCompulsoryTask(kind: string | null | undefined) {
  return kind === "GST_BANK_ACCOUNT";
}

// A GSTIN: 15 characters starting with the state code (as the client import checks)
export const GSTIN_PATTERN = /^\d{2}[A-Z0-9]{13}$/;

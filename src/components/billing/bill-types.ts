import axios from "axios";
import { BillStatusValue, BillTypeValue, CompanyValue, MvcBillTypeValue } from "@/lib/billing-constants";
import { ClientOption } from "./client-picker";

// A bill as returned by /api/bills (amounts are null when the user may not see them)
export interface Bill {
  id: string;
  company: CompanyValue;
  type: BillTypeValue | null;
  status: BillStatusValue;
  description: string;
  workDate: string;
  remark: string | null;
  task: { id: string; title: string } | null;
  client: (ClientOption & { gstin?: string | null }) | null;
  billToName: string | null;
  billToAddress: string | null;
  billToGstin: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  amountRequestedFrom: { id: string; name: string } | null;
  amountEnteredBy: { id: string; name: string } | null;
  amountEnteredAt: string | null;
  amount: number | null;
  billNumber: string | null;
  billDate: string | null;
  reissuedFrom: { id: string; billNumber: string | null } | null;
  reissuedAs: { id: string; billNumber: string | null } | null;
  pendingChange: PendingChange | null;
  tallyExportedAt: string | null;
  tallyNeedsUpdate: boolean;
  emailedAt: string | null;
  emailedTo: string | null;
  // Delivery of the last email: failed and delayed come with a reason
  emailStatus: "sent" | "delayed" | "failed" | null;
  emailError: string | null;
  emailStatusAt: string | null;
  canManage: boolean;
}

export interface BillChanges {
  amount?: number;
  description?: string;
  workDate?: string;
  clientId?: string;
  type?: MvcBillTypeValue;
}

export interface PendingChange {
  id: string;
  kind: "edit" | "cancel" | "reissue";
  reason: string;
  changes: BillChanges | null;
  createdAt: string;
  requestedBy: { id: string; name: string };
}

// Who the bill is made out to: the saved client, or the name entered under "Other"
export function billParty(bill: {
  client?: { contactPerson: string; companyName?: string | null } | null;
  billToName?: string | null;
}) {
  return bill.client ? bill.client.companyName || bill.client.contactPerson : bill.billToName || null;
}

export interface BillEvent {
  id: string;
  action: string;
  remark: string | null;
  createdAt: string;
  user: { id: string; name: string };
}

export type BillAction =
  | { action: "set_type"; type: MvcBillTypeValue }
  | { action: "request_amount"; userId: string }
  | { action: "enter_amount"; amount: number; type?: MvcBillTypeValue }
  | { action: "send_back"; remark: string }
  | { action: "not_billable"; remark?: string }
  | { action: "reopen" }
  | { action: "manager_approve" }
  | { action: "final_approve" }
  | { action: "final_reject"; remark: string };

export interface BatchResult {
  done: string[];
  skipped: { id: string; reason: string }[];
}

export async function runBulkApproval(action: "manager_approve" | "final_approve", ids: string[]) {
  const response = await axios.post<BatchResult>("/api/bills/bulk", { action, ids });
  return response.data;
}

export async function runBillAction(billId: string, action: BillAction): Promise<Bill> {
  const response = await axios.post<Bill>(`/api/bills/${billId}`, action);
  return response.data;
}

export function apiErrorMessage(error: unknown, fallback = "Something went wrong") {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === "string") {
    return error.response.data.error;
  }
  return fallback;
}

export const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  type_set: "Bill type set",
  amount_requested: "Sent for amount",
  amount_entered: "Amount entered",
  sent_back: "Sent back",
  not_billable: "Marked not billable",
  reopened: "Reopened",
  details_updated: "Details updated",
  company_changed: "Company changed",
  manager_approved: "Approved by billing manager",
  final_rejected: "Returned by Admin",
  approved: "Final approval",
  edit_requested: "Edit requested",
  cancel_requested: "Cancellation requested",
  reissue_requested: "Reissue requested",
  change_rejected: "Request rejected",
  edited: "Edited",
  cancelled: "Cancelled",
  reissued: "Reissued",
  emailed: "Emailed to party",
  email_failed: "Email not delivered",
  email_delayed: "Email delivery delayed",
};

export const CHANGE_KIND_LABELS = { edit: "Edit", cancel: "Cancel", reissue: "Reissue" } as const;

// Downloads a bill file from the API and saves it under the server's file name
export async function downloadBillFile(
  request: { method: "get"; url: string } | { method: "post"; url: string; data: unknown }
) {
  const response = await axios.request<Blob>({ ...request, responseType: "blob" });
  const disposition = String(response.headers["content-disposition"] || "");
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || "bill";
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Error bodies of blob requests arrive as a Blob, not JSON
export async function blobErrorMessage(error: unknown, fallback = "Download failed") {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const body = JSON.parse(await error.response.data.text());
      if (typeof body.error === "string") return body.error;
    } catch {
      // not JSON
    }
  }
  return fallback;
}

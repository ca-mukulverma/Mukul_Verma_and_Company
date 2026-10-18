import axios from "axios";
import { BillStatusValue, BillTypeValue, CompanyValue } from "@/lib/billing-constants";
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
  canManage: boolean;
}

export interface BillChanges {
  amount?: number;
  description?: string;
  workDate?: string;
  clientId?: string;
  type?: "GST" | "NON_GST";
}

export interface PendingChange {
  id: string;
  kind: "edit" | "cancel" | "reissue";
  reason: string;
  changes: BillChanges | null;
  createdAt: string;
  requestedBy: { id: string; name: string };
}

export interface BillEvent {
  id: string;
  action: string;
  remark: string | null;
  createdAt: string;
  user: { id: string; name: string };
}

export type BillAction =
  | { action: "set_type"; type: "GST" | "NON_GST" }
  | { action: "request_amount"; userId: string }
  | { action: "enter_amount"; amount: number }
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
};

export const CHANGE_KIND_LABELS = { edit: "Edit", cancel: "Cancel", reissue: "Reissue" } as const;

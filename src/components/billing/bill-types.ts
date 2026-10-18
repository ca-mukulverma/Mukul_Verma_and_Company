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
  canManage: boolean;
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
  | { action: "reopen" };

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
};

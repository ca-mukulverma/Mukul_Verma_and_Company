"use client";

import { Clock } from "lucide-react";
import { BILL_OVERDUE_DAYS, WAITING_BILL_STATUSES } from "@/lib/billing-constants";
import { cn } from "@/lib/utils";
import { Bill } from "./bill-types";

const DAY = 86_400_000;

// Calendar days at the current stage, counted as the red alert counts them
export function daysWaiting(bill: Pick<Bill, "status" | "statusChangedAt">) {
  if (!WAITING_BILL_STATUSES.includes(bill.status)) return null;
  return Math.max(Math.floor((Date.now() - new Date(bill.statusChangedAt).getTime()) / DAY), 0);
}

// Where the bill is now and whose turn it is, in plain words
export function billWhereabouts(bill: Bill) {
  switch (bill.status) {
    case "draft":
      return "With the billing manager";
    case "awaiting_amount":
      return bill.amountRequestedFrom ? `With ${bill.amountRequestedFrom.name} for the amount` : "With a partner for the amount";
    case "amount_entered":
      return "With the billing manager for approval";
    case "manager_approved":
      return "With Admin for final approval";
    case "approved":
      return bill.billNumber ? `Billed: no. ${bill.billNumber}` : "Billed";
    case "cancelled":
      return "Cancelled";
    case "not_billable":
      return "Set aside: not billable";
  }
}

// "3 days" next to the status: amber from 2 days, red once overdue
export function WaitingChip({ bill }: { bill: Bill }) {
  const days = daysWaiting(bill);
  if (days === null) return null;
  const overdue = days >= BILL_OVERDUE_DAYS;
  return (
    <span
      title={overdue ? `Waiting ${days} days at this stage: overdue` : `Waiting ${days} days at this stage`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        overdue
          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
          : days >= BILL_OVERDUE_DAYS - 1
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-muted text-muted-foreground"
      )}
    >
      <Clock className="h-3 w-3" />
      {days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`}
    </span>
  );
}

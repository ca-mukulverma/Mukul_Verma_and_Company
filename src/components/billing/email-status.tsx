"use client";

import { formatIndianDate } from "@/lib/billing-constants";
import { cn } from "@/lib/utils";
import { Bill } from "./bill-types";

// Gmail gives up on a delayed email within about 2 days and then reports the
// failure, so a delay with nothing reported for 3 days means it was delivered
const DELAY_SETTLED_MS = 3 * 24 * 3600 * 1000;

export function emailState(bill: Pick<Bill, "emailStatus" | "emailStatusAt">) {
  if (bill.emailStatus === "delayed" && bill.emailStatusAt && Date.now() - new Date(bill.emailStatusAt).getTime() > DELAY_SETTLED_MS) {
    return "sent";
  }
  return bill.emailStatus;
}

// Whether the bill's last email reached the party, and if not, why
export function EmailStatus({
  bill,
  compact,
}: {
  bill: Pick<Bill, "status" | "emailedAt" | "emailedTo" | "emailStatus" | "emailError" | "emailStatusAt">;
  // One line, for bill cards
  compact?: boolean;
}) {
  const state = emailState(bill);
  const when = bill.emailedAt ? formatIndianDate(bill.emailedAt, "medium") : null;

  if (!state || !when) {
    if (compact) return null;
    return bill.status === "cancelled" ? (
      <>—</>
    ) : (
      <span className="whitespace-nowrap text-xs text-amber-700 dark:text-amber-400">Not emailed</span>
    );
  }

  const tone =
    state === "failed"
      ? "text-red-700 dark:text-red-400"
      : state === "delayed"
        ? "text-amber-700 dark:text-amber-400"
        : "text-green-700 dark:text-green-400";
  const title = state === "failed" ? "Not delivered" : state === "delayed" ? "Delivery delayed" : `Emailed on ${when}`;

  if (compact) {
    return (
      <span className={tone}>
        {title}
        {state !== "sent" && ` (emailed on ${when})`}
        {bill.emailedTo && ` to ${bill.emailedTo}`}
        {state !== "sent" && bill.emailError && `: ${bill.emailError}`}
      </span>
    );
  }

  return (
    <>
      <p className={cn("whitespace-nowrap font-medium", tone)}>{title}</p>
      {state !== "sent" && bill.emailError && <p className={cn("text-xs", tone)}>{bill.emailError}</p>}
      <p className="text-xs text-muted-foreground break-words">
        {state !== "sent" && `Emailed on ${when} `}
        {bill.emailedTo && `to ${bill.emailedTo}`}
      </p>
    </>
  );
}

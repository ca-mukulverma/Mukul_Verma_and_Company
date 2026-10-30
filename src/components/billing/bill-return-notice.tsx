"use client";

import { format } from "date-fns";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isReturnOpen } from "@/lib/billing-constants";
import { cn } from "@/lib/utils";
import { Bill } from "./bill-types";

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
};

function returnTitle(bill: Bill, earlier: boolean) {
  const returned = bill.returned!;
  const by = returned.by?.name ?? "someone";
  const what = returned.kind === "final_rejected" ? `returned by ${by} (Admin)` : `sent back by ${by}`;
  return earlier ? `Earlier ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

// Next to the status, while the comment is waiting for the billing manager
export function BillReturnBadge({ bill }: { bill: Bill }) {
  if (!bill.returned || !isReturnOpen(bill.status, bill.returned.kind)) return null;
  return (
    <Badge variant="outline" className="border-0 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
      <Undo2 className="mr-1 h-3 w-3" />
      {bill.returned.kind === "final_rejected" ? "Returned by Admin" : "Sent back"}
      {bill.returned.count > 1 && ` · ${bill.returned.count}×`}
    </Badge>
  );
}

// The comment of the last send-back or Admin return, in full. Prominent while
// the bill is still where it was sent back to; once it has moved on it stays
// as a quieter note until final approval, so the next person sees what was
// asked for.
export function BillReturnNotice({ bill, className }: { bill: Bill; className?: string }) {
  const returned = bill.returned;
  if (!returned) return null;
  const open = isReturnOpen(bill.status, returned.kind);

  return (
    <div
      role={open ? "alert" : undefined}
      className={cn(
        "rounded-md border p-3 text-sm",
        open
          ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          : "border-border bg-muted/40 text-muted-foreground",
        className
      )}
    >
      <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5", open ? "font-semibold" : "text-xs font-medium")}>
        <Undo2 className="h-3.5 w-3.5 shrink-0" />
        <span>{returnTitle(bill, !open)}</span>
        {returned.at && (
          <span className="font-normal opacity-80">{format(new Date(returned.at), "d MMM yyyy, h:mm a")}</span>
        )}
        {returned.count > 1 && (
          <span className="font-normal opacity-80">· {ordinal(returned.count)} time</span>
        )}
      </p>
      {returned.remark && (
        <p className={cn("mt-1 whitespace-pre-line break-words", !open && "text-xs")}>“{returned.remark}”</p>
      )}
      {open && (
        <p className="mt-1 text-xs opacity-80">
          {returned.kind === "final_rejected"
            ? "Make the change asked for before approving it again. Earlier comments are in History."
            : "Deal with this before sending it for the amount again. Earlier comments are in History."}
        </p>
      )}
    </div>
  );
}

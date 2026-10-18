"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Ban, CheckCheck, History, IndianRupee, Loader2, MoreVertical, Pencil, RotateCcw, Search, Send, Undo2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import {
  BILL_STATUS_LABELS,
  BillStatusValue,
  CompanyValue,
  EDITABLE_BILL_STATUSES,
  formatRupees,
  gstAmount,
} from "@/lib/billing-constants";
import { CompanyBadge } from "./company-select";
import {
  BillDialog,
  EditDetailsDialog,
  EnterAmountDialog,
  HistoryDialog,
  RemarkDialog,
  RequestAmountDialog,
} from "./bill-dialogs";
import { apiErrorMessage, Bill, runBillAction, runBulkApproval } from "./bill-types";

// manage  – billing manager's bills of one company
// final   – Admin's final approval queue (all companies)
// amounts – bills sent to the user for the amount
// mine    – work the user logged or completed
export type BillListMode = "manage" | "final" | "amounts" | "mine";

const STATUS_STYLES: Record<BillStatusValue, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  awaiting_amount: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  amount_entered: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  manager_approved: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  not_billable: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

// Status filters shown to billing managers
const MANAGE_FILTERS: { value: string; label: string }[] = [
  { value: "draft", label: "Drafts" },
  { value: "awaiting_amount", label: "Awaiting amount" },
  { value: "amount_entered", label: "Amount entered" },
  { value: "manager_approved", label: "Awaiting final approval" },
  { value: "not_billable", label: "Not billable" },
  { value: "all", label: "All" },
];

export function BillStatusBadge({ status }: { status: BillStatusValue }) {
  return <Badge variant="outline" className={cn("border-0", STATUS_STYLES[status])}>{BILL_STATUS_LABELS[status]}</Badge>;
}

export function BillList({
  mode,
  company,
  counts,
  onChanged,
}: {
  mode: BillListMode;
  company?: CompanyValue;
  counts?: Record<string, number>;
  // Called after any change so the page can refresh its counts
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState(
    mode === "manage" ? "draft" : mode === "amounts" ? "awaiting_amount" : mode === "final" ? "manager_approved" : "all"
  );
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ bill: Bill; dialog: BillDialog } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);

  // Bills that can be approved together: the manager's "amount entered" list
  // and Admin's final approval queue
  const approvalAction =
    mode === "final" ? "final_approve" : mode === "manage" && status === "amount_entered" ? "manager_approve" : null;

  const load = useCallback(async () => {
    try {
      const response = await axios.get("/api/bills", {
        params: {
          view: mode === "final" ? "manage" : mode,
          company,
          status,
          search: debouncedSearch || undefined,
          page,
        },
      });
      setBills(response.data.bills);
      setTotal(response.data.total);
      setSelected(new Set());
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load bills"));
      setBills([]);
    }
  }, [mode, company, status, debouncedSearch, page]);

  useEffect(() => {
    setBills(null);
    load();
  }, [load]);

  useEffect(() => setPage(1), [status, debouncedSearch]);

  // A changed bill may no longer match the filter, so reload the list
  const handleDone = () => {
    load();
    onChanged?.();
  };

  const setType = async (bill: Bill, type: "GST" | "NON_GST") => {
    try {
      await runBillAction(bill.id, { action: "set_type", type });
      handleDone();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const approve = async (ids: string[]) => {
    if (!approvalAction || ids.length === 0) return;
    setApproving(true);
    try {
      const result = await runBulkApproval(approvalAction, ids);
      if (result.done.length > 0) {
        toast.success(
          approvalAction === "final_approve"
            ? `${result.done.length} bill${result.done.length === 1 ? "" : "s"} approved and numbered`
            : `${result.done.length} bill${result.done.length === 1 ? "" : "s"} sent for final approval`
        );
      }
      if (result.skipped.length > 0) {
        toast.error(`${result.skipped.length} not approved: ${result.skipped[0].reason}`);
      }
      handleDone();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setApproving(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const reopen = async (bill: Bill) => {
    try {
      await runBillAction(bill.id, { action: "reopen" });
      toast.success("Bill reopened");
      handleDone();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const pages = Math.max(Math.ceil(total / 50), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        {mode === "manage" ? (
          <div className="flex flex-wrap gap-2">
            {MANAGE_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                size="sm"
                variant={status === filter.value ? "default" : "outline"}
                onClick={() => setStatus(filter.value)}
              >
                {filter.label}
                {counts && filter.value !== "all" && (counts[filter.value] ?? 0) > 0 && (
                  <span className="ml-1.5 rounded-full bg-background/20 px-1.5 text-xs">{counts[filter.value]}</span>
                )}
              </Button>
            ))}
          </div>
        ) : (
          <div />
        )}
        <div className="relative sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client or work"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {approvalAction && bills && bills.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.size === bills.length}
              onCheckedChange={(checked) => setSelected(checked ? new Set(bills.map((b) => b.id)) : new Set())}
              aria-label="Select all"
            />
            Select all
          </label>
          <Button size="sm" disabled={selected.size === 0 || approving} onClick={() => approve([...selected])}>
            {approving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="mr-1 h-3.5 w-3.5" />}
            {approvalAction === "final_approve" ? "Give final approval" : "Approve"} ({selected.size})
          </Button>
        </div>
      )}

      {bills === null ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : bills.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">
          {mode === "amounts"
            ? "No bills are waiting for your amount."
            : mode === "final"
              ? "No bills are waiting for final approval."
              : "No bills here."}
        </p>
      ) : (
        <div className="space-y-3">
          {bills.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              mode={mode}
              onOpen={(dialog) => setOpen({ bill, dialog })}
              onSetType={(type) => setType(bill, type)}
              onReopen={() => reopen(bill)}
              onApprove={approvalAction ? () => approve([bill.id]) : undefined}
              approving={approving}
              selected={approvalAction ? selected.has(bill.id) : undefined}
              onToggle={() => toggle(bill.id)}
            />
          ))}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      {open?.dialog === "amount" && <EnterAmountDialog bill={open.bill} onClose={() => setOpen(null)} onDone={handleDone} />}
      {open?.dialog === "request" && <RequestAmountDialog bill={open.bill} onClose={() => setOpen(null)} onDone={handleDone} />}
      {(open?.dialog === "send_back" || open?.dialog === "not_billable" || open?.dialog === "final_reject") && (
        <RemarkDialog bill={open.bill} kind={open.dialog} onClose={() => setOpen(null)} onDone={handleDone} />
      )}
      {open?.dialog === "details" && <EditDetailsDialog bill={open.bill} onClose={() => setOpen(null)} onDone={handleDone} />}
      {open?.dialog === "history" && <HistoryDialog bill={open.bill} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BillCard({
  bill,
  mode,
  onOpen,
  onSetType,
  onReopen,
  onApprove,
  approving,
  selected,
  onToggle,
}: {
  bill: Bill;
  mode: BillListMode;
  onOpen: (dialog: BillDialog) => void;
  onSetType: (type: "GST" | "NON_GST") => void;
  onReopen: () => void;
  onApprove?: () => void;
  approving?: boolean;
  // undefined when the bill can't be selected
  selected?: boolean;
  onToggle: () => void;
}) {
  const [title, ...rest] = bill.description.split("\n");
  const clientName = bill.client ? bill.client.companyName || bill.client.contactPerson : null;
  const editable = (EDITABLE_BILL_STATUSES as string[]).includes(bill.status);
  const canManage = mode === "manage" && bill.canManage;
  const isAwaitingMe = mode === "amounts" && bill.status === "awaiting_amount";

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          {selected !== undefined && (
            <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-1" aria-label="Select bill" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <BillStatusBadge status={bill.status} />
              <CompanyBadge company={bill.company} />
              {mode === "final" && bill.type && bill.company === "MVC" && (
                <Badge variant="outline">{bill.type === "GST" ? "GST" : "Non-GST"}</Badge>
              )}
              {bill.billNumber && <Badge variant="secondary">{bill.billNumber}</Badge>}
            </div>
            <p className="font-medium break-words">
              {clientName ?? <span className="text-destructive">No client selected</span>}
            </p>
            <p className="text-sm break-words">{title}</p>
            {rest.length > 0 && <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-2">{rest.join("\n")}</p>}
          </div>
          {bill.amount !== null && (
            <div className="text-right shrink-0">
              <p className="font-semibold">{formatRupees(bill.amount)}</p>
              {bill.type === "GST" && (
                <p className="text-xs text-muted-foreground">+ GST {formatRupees(gstAmount(bill.amount))}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Work date: {format(new Date(bill.workDate), "d MMM yyyy")}</span>
          <span>
            {bill.task ? (
              <>From task: <Link href={`/dashboard/tasks/${bill.task.id}`} className="underline">{bill.task.title}</Link></>
            ) : (
              <>Logged by {bill.createdBy.name}</>
            )}
          </span>
          {bill.amountRequestedFrom && bill.status === "awaiting_amount" && (
            <span>Waiting for {bill.amountRequestedFrom.name}</span>
          )}
          {bill.amountEnteredBy && <span>Amount by {bill.amountEnteredBy.name}</span>}
        </div>
        {bill.remark && <p className="text-xs text-muted-foreground">Remark: {bill.remark}</p>}

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {bill.company === "MVC" && editable && (
              <Select value={bill.type ?? undefined} onValueChange={(value) => onSetType(value as "GST" | "NON_GST")}>
                <SelectTrigger className={cn("h-8 w-auto min-w-44", !bill.type && "border-amber-500")}>
                  <SelectValue placeholder="Choose GST / Non-GST" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GST">GST – MVC & Company</SelectItem>
                  <SelectItem value="NON_GST">Non-GST – CA Mukul Verma</SelectItem>
                </SelectContent>
              </Select>
            )}
            {bill.company === "MVC" && !editable && bill.type && (
              <Badge variant="outline">{bill.type === "GST" ? "GST – MVC & Company" : "Non-GST – CA Mukul Verma"}</Badge>
            )}
            {editable && !bill.client && (
              <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => onOpen("details")}>
                <UserPlus className="mr-1 h-3.5 w-3.5" />Choose client
              </Button>
            )}
            {editable && (
              <Button size="sm" variant="outline" disabled={!bill.type || !bill.client} onClick={() => onOpen("amount")}>
                <IndianRupee className="mr-1 h-3.5 w-3.5" />
                {bill.amount !== null ? "Change amount" : "Enter amount"}
              </Button>
            )}
            {bill.status === "amount_entered" && onApprove && (
              <Button size="sm" disabled={approving || !bill.type || !bill.client || bill.amount === null} onClick={onApprove}>
                <CheckCheck className="mr-1 h-3.5 w-3.5" />Approve
              </Button>
            )}
            {(bill.status === "draft" || bill.status === "awaiting_amount") && (
              <Button size="sm" variant="outline" disabled={!bill.type || !bill.client} onClick={() => onOpen("request")}>
                <Send className="mr-1 h-3.5 w-3.5" />
                {bill.status === "awaiting_amount" ? "Send to someone else" : "Send for amount"}
              </Button>
            )}
            {bill.status === "not_billable" && (
              <Button size="sm" variant="outline" onClick={onReopen}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />Reopen
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {editable && (
                  <DropdownMenuItem onClick={() => onOpen("details")}>
                    <Pencil className="mr-2 h-4 w-4" />Edit details
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onOpen("history")}>
                  <History className="mr-2 h-4 w-4" />History
                </DropdownMenuItem>
                {editable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => onOpen("not_billable")}>
                      <Ban className="mr-2 h-4 w-4" />Not billable
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {canManage && editable && (!bill.type || !bill.client) && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {!bill.client && !bill.type
              ? "Choose the client and GST / Non-GST before entering the amount or sending it for the amount."
              : !bill.client
                ? "Choose the client before entering the amount or sending it for the amount."
                : "Choose GST / Non-GST before entering the amount or sending it for the amount."}
          </p>
        )}

        {mode === "final" && bill.status === "manager_approved" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" disabled={approving} onClick={onApprove}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" />Give final approval
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpen("final_reject")}>
              <Undo2 className="mr-1 h-3.5 w-3.5" />Return
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpen("history")}>
              <History className="mr-1 h-3.5 w-3.5" />History
            </Button>
          </div>
        )}

        {isAwaitingMe && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => onOpen("amount")}>
              <IndianRupee className="mr-1 h-3.5 w-3.5" />Enter amount
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpen("send_back")}>
              <Undo2 className="mr-1 h-3.5 w-3.5" />Send back
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpen("history")}>
              <History className="mr-1 h-3.5 w-3.5" />History
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

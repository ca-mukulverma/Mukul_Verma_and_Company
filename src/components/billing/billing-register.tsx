"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Ban, History, Loader2, MoreVertical, Pencil, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { useDebounce } from "@/hooks/use-debounce";
import { BILL_TYPE_LABELS, BillTypeValue, CompanyValue, formatRupees, gstAmount } from "@/lib/billing-constants";
import { HistoryDialog } from "./bill-dialogs";
import { BillStatusBadge } from "./bill-list";
import { apiErrorMessage, Bill, CHANGE_KIND_LABELS } from "./bill-types";
import { ChangeKind, ChangeRequestDialog } from "./change-request-dialog";

// Numbered bills (approved and cancelled) of the companies the user manages
export function BillingRegister({ manages, onChanged }: { manages: CompanyValue[]; onChanged?: () => void }) {
  const types: BillTypeValue[] = [
    ...(manages.includes("MVC") ? (["GST", "NON_GST"] as const) : []),
    ...(manages.includes("BEDGE") ? (["BEDGE"] as const) : []),
  ];
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ bills: Bill[]; total: number; totals: { type: BillTypeValue; amount: number }[] } | null>(null);
  const [open, setOpen] = useState<{ bill: Bill; dialog: ChangeKind | "history" } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await axios.get("/api/bills", {
        params: {
          view: "list",
          type,
          status,
          from: from || undefined,
          to: to || undefined,
          search: debouncedSearch || undefined,
          page,
        },
      });
      setData(response.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load the billing list"));
      setData({ bills: [], total: 0, totals: [] });
    }
  }, [type, status, from, to, debouncedSearch, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setPage(1), [type, status, from, to, debouncedSearch]);

  const pages = data ? Math.max(Math.ceil(data.total / 50), 1) : 1;

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 col-span-2 lg:col-span-1">
          <Label className="text-xs">Series</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All series</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>{BILL_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="register-from">From</Label>
          <Input id="register-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="register-to">To</Label>
          <Input id="register-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Approved and cancelled</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="register-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="register-search"
              placeholder="Client or work"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {data && data.totals.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {data.totals.map((row) => (
            <div key={row.type} className="rounded-md border px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">{BILL_TYPE_LABELS[row.type]}</p>
              <p className="font-semibold">
                {formatRupees(row.amount)}
                {row.type === "GST" && (
                  <span className="font-normal text-muted-foreground"> + GST {formatRupees(gstAmount(row.amount))}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {data === null ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : data.bills.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">No bills match these filters.</p>
      ) : (
        // w-0 + min-w-full: the table scrolls inside its box instead of
        // widening the page on phones
        <ResponsiveTable className="w-0 min-w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill no.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Work</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bills.map((bill) => {
                const fee = bill.amount ?? 0;
                const gst = bill.type === "GST" ? gstAmount(fee) : 0;
                const cancelled = bill.status === "cancelled";
                return (
                  <TableRow key={bill.id} className={cancelled ? "text-muted-foreground" : undefined}>
                    <TableCell className="font-mono whitespace-nowrap">
                      <span className={cancelled ? "line-through" : undefined}>{bill.billNumber}</span>
                      <p className="font-sans text-xs text-muted-foreground">
                        {bill.type ? BILL_TYPE_LABELS[bill.type].split(" – ")[0] : ""}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {bill.billDate ? format(new Date(bill.billDate), "d MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell className="min-w-40">
                      {bill.client ? bill.client.companyName || bill.client.contactPerson : "—"}
                    </TableCell>
                    <TableCell className="min-w-48 max-w-72">
                      <p className="line-clamp-2">{bill.description.split("\n")[0]}</p>
                      {bill.reissuedFrom && (
                        <p className="text-xs text-muted-foreground">Replaces {bill.reissuedFrom.billNumber}</p>
                      )}
                      {bill.reissuedAs && (
                        <p className="text-xs text-muted-foreground">Reissued as {bill.reissuedAs.billNumber}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatRupees(fee)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{gst ? formatRupees(gst) : "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium">{formatRupees(fee + gst)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <BillStatusBadge status={bill.status} />
                        {bill.pendingChange && (
                          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300 whitespace-nowrap">
                            {CHANGE_KIND_LABELS[bill.pendingChange.kind]} requested
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Bill actions">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setOpen({ bill, dialog: "history" })}>
                            <History className="mr-2 h-4 w-4" />History
                          </DropdownMenuItem>
                          {bill.status === "approved" && !bill.pendingChange && (
                            <>
                              <DropdownMenuItem onClick={() => setOpen({ bill, dialog: "edit" })}>
                                <Pencil className="mr-2 h-4 w-4" />Request edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setOpen({ bill, dialog: "reissue" })}>
                                <RefreshCw className="mr-2 h-4 w-4" />Request reissue
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setOpen({ bill, dialog: "cancel" })}>
                                <Ban className="mr-2 h-4 w-4" />Request cancellation
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ResponsiveTable>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {open?.dialog === "history" && <HistoryDialog bill={open.bill} onClose={() => setOpen(null)} />}
      {open && open.dialog !== "history" && (
        <ChangeRequestDialog
          bill={open.bill}
          kind={open.dialog}
          onClose={() => setOpen(null)}
          onDone={() => {
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

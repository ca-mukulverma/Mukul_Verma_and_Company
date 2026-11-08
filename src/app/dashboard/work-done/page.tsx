"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, ListChecks, Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CompanyBadge } from "@/components/billing/company-select";
import { HelpLink } from "@/components/help/help-link";
import { useLanguage } from "@/components/language-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { apiError } from "@/components/compliance/types";
import { cn } from "@/lib/utils";
import type { Person, StaffCount, WorkDoneRow, WorkSource } from "@/lib/work-done";

// Work Done: finished tasks, logged work and compliance, with who did it.
// Admin and the partners Admin allows see everyone's; others see their own.
// Loaded only when the page opens or a filter changes (no auto-refresh).

interface WorkDoneResponse {
  seesAll: boolean;
  from: string;
  to: string;
  rows: WorkDoneRow[];
  total: number;
  page: number;
  pages: number;
  byStaff: StaffCount[];
  staff: Person[];
  tooMany: boolean;
}

const SOURCE_LABELS: Record<WorkSource, string> = {
  task: "Task",
  logged: "Logged work",
  compliance: "Compliance",
};

const SOURCE_STYLES: Record<WorkSource, string> = {
  task: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  logged: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  compliance: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
};

const ALL = "all";

// Calendar days in India, YYYY-MM-DD
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
function monthRange(offset: number) {
  const [y, m] = istToday().split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 + offset, 1));
  const end = new Date(Date.UTC(y, m + offset, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: offset === 0 ? istToday() : iso(end) };
}
const fmtDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function SourceBadge({ source }: { source: WorkSource }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", SOURCE_STYLES[source])}>
      {SOURCE_LABELS[source]}
    </Badge>
  );
}

function RowLink({ href, className, children }: { href: string | null; className: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

function DoneBy({ row }: { row: WorkDoneRow }) {
  return (
    <div>
      <p className="font-medium">{row.doneBy.length ? row.doneBy.map((p) => p.name).join(", ") : "—"}</p>
      {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
    </div>
  );
}

export default function WorkDonePage() {
  const { t } = useLanguage();
  const [range, setRange] = useState(() => monthRange(0));
  const [userId, setUserId] = useState(ALL);
  const [company, setCompany] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [searchText, setSearchText] = useState("");
  const search = useDebounce(searchText.trim(), 500);
  // The page belongs to the filters it was picked for: new filters start at 1
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const [view, setView] = useState<"list" | "staff">("list");
  const [data, setData] = useState<WorkDoneResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const params = useCallback(
    () => ({
      from: range.from,
      to: range.to,
      ...(userId !== ALL && { user: userId }),
      ...(company !== ALL && { company }),
      ...(source !== ALL && { source }),
      ...(search && { search }),
    }),
    [range, userId, company, source, search]
  );

  const filterKey = JSON.stringify(params());
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (next: number) => setPaging({ key: filterKey, page: next });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios
      .get<WorkDoneResponse>("/api/work-done", { params: { ...params(), page } })
      .then(({ data }) => !cancelled && setData(data))
      .catch((error) => !cancelled && toast.error(apiError(error, "Could not load the work done")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params, page]);

  const download = async () => {
    setDownloading(true);
    try {
      const response = await axios.get("/api/work-done/export", { params: params(), responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Work Done ${range.from} to ${range.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      // The error comes back as a blob: read the message from it
      let message = "Could not download the Excel file";
      const blob = (error as { response?: { data?: Blob } }).response?.data;
      if (blob instanceof Blob) {
        try {
          message = JSON.parse(await blob.text()).error || message;
        } catch {}
      }
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  };

  const seesAll = data?.seesAll ?? false;
  const filtered = userId !== ALL || company !== ALL || source !== ALL || !!search;
  const thisMonth = monthRange(0);
  const lastMonth = monthRange(-1);
  const isRange = (r: { from: string; to: string }) => r.from === range.from && r.to === range.to;
  const mine = !seesAll && data?.byStaff[0];

  const showPerson = (id: string) => {
    setUserId(id);
    setView("list");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <ListChecks className="h-6 w-6" />
              {t("Work done")}
            </h1>
            <HelpLink section="work-done" />
          </div>
          <p className="text-sm text-muted-foreground">
            {seesAll
              ? "Finished tasks, logged work and compliance returns, with who did each one."
              : "Your finished tasks, logged work and compliance returns."}
          </p>
        </div>
        <Button variant="outline" onClick={download} disabled={downloading || loading || !data?.total}>
          {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
          Excel
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="wd-from">From</Label>
              <Input
                id="wd-from"
                type="date"
                className="w-40"
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wd-to">To</Label>
              <Input
                id="wd-to"
                type="date"
                className="w-40"
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              />
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant={isRange(thisMonth) ? "secondary" : "ghost"} onClick={() => setRange(thisMonth)}>
                This month
              </Button>
              <Button size="sm" variant={isRange(lastMonth) ? "secondary" : "ghost"} onClick={() => setRange(lastMonth)}>
                Last month
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {seesAll && (
              <div className="space-y-1">
                <Label>Staff</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Everyone</SelectItem>
                    {data?.staff.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                    {/* Someone no longer active but picked from By staff */}
                    {userId !== ALL && !data?.staff.some((p) => p.id === userId) && (
                      <SelectItem value={userId}>{data?.byStaff.find((p) => p.id === userId)?.name ?? "Selected person"}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Firm</Label>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Both</SelectItem>
                  <SelectItem value="MVC">MVC</SelectItem>
                  <SelectItem value="BEDGE">B Edge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Kind of work</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {(Object.keys(SOURCE_LABELS) as WorkSource[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1">
              <Label htmlFor="wd-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="wd-search"
                  className="pl-8"
                  placeholder="Work or client name"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </div>
            </div>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setUserId(ALL);
                  setCompany(ALL);
                  setSource(ALL);
                  setSearchText("");
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {data?.tooMany && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          There is too much work in these dates to show all of it. Choose shorter dates.
        </p>
      )}

      {mine && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Total", mine.total],
              ["Tasks", mine.task],
              ["Logged work", mine.logged],
              ["Compliance", mine.compliance],
            ] as const
          ).map(([label, value]) => (
            <Card key={label}>
              <CardContent>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {seesAll && (
        <div className="flex gap-1">
          <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}>
            List
          </Button>
          <Button size="sm" variant={view === "staff" ? "secondary" : "ghost"} onClick={() => setView("staff")}>
            By staff
          </Button>
        </div>
      )}

      {!data && loading ? (
        <Card>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : !data ? null : view === "staff" && seesAll ? (
        <Card className={cn(loading && "opacity-60")}>
          <CardHeader>
            <CardTitle>By staff</CardTitle>
            <CardDescription>
              Work done from {fmtDate(data.from)} to {fmtDate(data.to)}. Click a name to see their work.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.byStaff.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No work found in these dates.</p>
            ) : (
              <div className="w-full overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Tasks</TableHead>
                      <TableHead className="text-right">Logged work</TableHead>
                      <TableHead className="text-right">Compliance</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byStaff.map((p) => (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => showPerson(p.id)}>
                        <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{p.name}</TableCell>
                        <TableCell className="text-right">{p.task}</TableCell>
                        <TableCell className="text-right">{p.logged}</TableCell>
                        <TableCell className="text-right">{p.compliance}</TableCell>
                        <TableCell className="text-right font-semibold">{p.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className={cn(loading && "opacity-60")}>
          <CardHeader>
            <CardTitle>
              {data.total} {data.total === 1 ? "piece of work" : "pieces of work"}
            </CardTitle>
            <CardDescription>
              {fmtDate(data.from)} to {fmtDate(data.to)}. Click a row to open it.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.rows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No work found. Try other dates or clear the filters.</p>
            ) : (
              <>
                {/* Phones: one card per piece of work */}
                <div className="divide-y md:hidden">
                  {data.rows.map((row) => (
                    <RowLink key={row.key} href={row.href} className="block space-y-1 px-4 py-3 hover:bg-muted/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{fmtDate(row.date)}</span>
                        <div className="flex gap-1">
                          <SourceBadge source={row.source} />
                          <CompanyBadge company={row.company} />
                        </div>
                      </div>
                      <p className="font-medium">{row.work}</p>
                      {row.client && <p className="text-sm text-muted-foreground">{row.client}</p>}
                      <div className="flex items-end justify-between gap-2 text-sm">
                        <DoneBy row={row} />
                        <span className="text-xs text-muted-foreground">{row.status}</span>
                      </div>
                    </RowLink>
                  ))}
                </div>
                {/* Larger screens: a table */}
                <div className="hidden w-full overflow-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead>Done by</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Work</TableHead>
                        <TableHead>Firm</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((row) => (
                        <TableRow key={row.key} className={cn("relative align-top", row.href && "cursor-pointer")}>
                          <TableCell className="whitespace-nowrap">
                            {row.href ? (
                              // The link covers the whole row
                              <Link href={row.href} className="after:absolute after:inset-0" aria-label={`Open ${row.work}`}>
                                {fmtDate(row.date)}
                              </Link>
                            ) : (
                              fmtDate(row.date)
                            )}
                          </TableCell>
                          <TableCell>
                            <DoneBy row={row} />
                          </TableCell>
                          <TableCell>{row.client ?? "—"}</TableCell>
                          <TableCell className="max-w-md">{row.work}</TableCell>
                          <TableCell>
                            <CompanyBadge company={row.company} />
                          </TableCell>
                          <TableCell>
                            <SourceBadge source={row.source} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{row.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {data.pages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t px-6 py-3 text-sm">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  Page {data.page} of {data.pages}
                </span>
                <Button size="sm" variant="outline" disabled={page >= data.pages || loading} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

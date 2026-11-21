"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Minus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { UpdateBanner, useSyncStatus } from "@/components/debtors/sync-status";
import { rupees, SalesTrend } from "@/components/sales/sales-trend";
import { cn } from "@/lib/utils";
import { DEBTOR_ENTITIES, ENTITY_LABELS, istToday, type DebtorEntity } from "@/lib/tally-debtors-shared";
import type { SalesAnswer, SyncStatus } from "@/lib/tally-debtors";
import type { BreakdownRow, ClientRow, Compared, PeriodKind } from "@/lib/tally-sales";

// Sales (Admin): each firm's sales from its Tally (income ledgers under Sales
// Accounts), MVC, B Edge and the total, for a day, week, month, quarter,
// financial year or chosen dates, against the same period a year before, with
// what made the change. docs/TALLY_DEBTORS.md

type FirmChoice = DebtorEntity | "ALL";
const KINDS: [PeriodKind, string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["quarter", "Quarter"],
  ["fy", "Year (FY)"],
  ["custom", "Dates"],
];

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function addMonthsTo(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
// The same period before / after (the arrows)
function step(kind: PeriodKind, date: string, dir: 1 | -1) {
  if (kind === "day") return addDays(date, dir);
  if (kind === "week") return addDays(date, 7 * dir);
  if (kind === "month") return addMonthsTo(date, dir);
  if (kind === "quarter") return addMonthsTo(date, 3 * dir);
  return addMonthsTo(date, 12 * dir);
}

export default function SalesPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SalesPage />
    </Suspense>
  );
}

function SalesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const today = istToday();
  const firmParam = search.get("firm");
  const firm: FirmChoice = firmParam === "MVC" || firmParam === "BEDGE" ? firmParam : "ALL";
  const kind = (KINDS.find(([k]) => k === search.get("period"))?.[0] ?? "month") as PeriodKind;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.get("date") ?? "") && search.get("date")! <= today ? search.get("date")! : today;
  const to = search.get("to") ?? today;
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const [data, setData] = useState<SalesAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [statuses, setStatuses] = useState<Partial<Record<DebtorEntity, SyncStatus>>>({});
  const syncMvc = useSyncStatus("MVC", statuses.MVC ?? null, reload);
  const syncBedge = useSyncStatus("BEDGE", statuses.BEDGE ?? null, reload);
  const syncs = { MVC: syncMvc, BEDGE: syncBedge };

  const params = { firm, period: kind, date, ...(kind === "custom" && { to }) };
  const paramKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    axios
      .get<SalesAnswer>("/api/sales", { params: JSON.parse(paramKey) })
      .then(({ data }) => !cancelled && (setData(data), setError(null)))
      .catch((e) => !cancelled && setError(apiError(e, "Could not work out the sales")));
    return () => {
      cancelled = true;
    };
  }, [paramKey, reloadKey]);

  // Each firm's update time (Redis only)
  useEffect(() => {
    let cancelled = false;
    Promise.all(DEBTOR_ENTITIES.map((e) => axios.get<SyncStatus>("/api/debtors/status", { params: { entity: e } }).then((r) => [e, r.data] as const)))
      .then((list) => !cancelled && setStatuses(Object.fromEntries(list)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const download = async () => {
    setDownloading(true);
    try {
      const response = await axios.get("/api/sales/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Sales ${data?.report.period.from ?? date} to ${data?.report.period.to ?? date} with year before.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Could not make the Excel file");
    } finally {
      setDownloading(false);
    }
  };

  const shown: DebtorEntity[] = firm === "ALL" ? [...DEBTOR_ENTITIES] : [firm];
  const r = data?.report;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <TrendingUp className="h-6 w-6" /> Sales
          </h1>
          <p className="text-sm text-muted-foreground">
            Sales from MVC&apos;s and B Edge&apos;s Tally (income ledgers, without GST), against the same period a year before, and what made
            the change.
          </p>
        </div>
        <Button variant="outline" onClick={download} disabled={downloading || !data}>
          {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1 h-4 w-4" />}
          Excel
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <Segmented
            label="Firm"
            value={firm}
            options={[
              ["ALL", "MVC + B Edge"],
              ["MVC", "MVC"],
              ["BEDGE", "B Edge"],
            ]}
            onChange={(v) => set({ firm: v })}
          />
          <Segmented label="Period" value={kind} options={KINDS} onChange={(v) => set({ period: v })} />
          {kind === "custom" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="sales-from">From</Label>
                <Input id="sales-from" type="date" className="w-40" max={today} value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sales-to">To</Label>
                <Input id="sales-to" type="date" className="w-40" min={date} max={today} value={to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
              </div>
            </>
          ) : (
            <div className="flex items-end gap-1">
              <Button variant="outline" size="icon" aria-label="The period before" onClick={() => set({ date: step(kind, date, -1) })}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="space-y-1">
                <Label htmlFor="sales-date">{kind === "day" ? "Day" : "A day in the period"}</Label>
                <Input id="sales-date" type="date" className="w-40" max={today} value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="The period after"
                disabled={step(kind, date, 1) > today && date === today}
                onClick={() => {
                  const next = step(kind, date, 1);
                  set({ date: next > today ? today : next });
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className={cn("grid gap-3", shown.length > 1 && "lg:grid-cols-2")}>
        {shown.map((e) => (
          <UpdateBanner key={e} sync={syncs[e]} compact />
        ))}
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!data || !r ? (
        !error && <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {data.firms
            .filter((f) => !f.hasSales)
            .map((f) => (
              <p key={f.entity} className="rounded-md bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950/50 dark:text-amber-50">
                No sales have come from {ENTITY_LABELS[f.entity]}&apos;s Tally yet. Update the Tally extension on its PC to 1.3.0 (Debtors → Tally
                PCs shows how), then press Refresh {ENTITY_LABELS[f.entity]}.
              </p>
            ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{r.period.label}</CardTitle>
              <CardDescription>
                Compared with {r.period.lyLabel}
                {r.period.kind === "week" ? " (the same weekdays, 52 weeks before)" : " (the same dates a year before)"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={cn("grid gap-3", firm === "ALL" ? "md:grid-cols-3" : "md:grid-cols-1")}>
                {firm === "ALL" && (["MVC", "BEDGE"] as DebtorEntity[]).map((e) => r.firms[e] && <Headline key={e} title={ENTITY_LABELS[e]} c={r.firms[e]!} />)}
                <Headline title={firm === "ALL" ? "Total" : ENTITY_LABELS[firm]} c={r.total} strong />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Where the change came from: clients</CardTitle>
              <CardDescription>Clients are matched by their Tally ledger name{firm === "ALL" ? " across both firms" : ""}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Bridge b={r.clients.bridge} counts={r.clients} />
              <div className="grid gap-4 lg:grid-cols-2">
                <ClientList title={`New clients (${r.clients.newCount})`} note="billed now, not in the same period a year before" rows={r.clients.topNew} show="now" />
                <ClientList title={`Not billed this time (${r.clients.lostCount})`} note="billed a year before, not now" rows={r.clients.topLost} show="before" />
                <ClientList title="Grew most" note="billed in both periods" rows={r.clients.topUp} show="change" />
                <ClientList title="Fell most" note="billed in both periods" rows={r.clients.topDown} show="change" />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 2xl:grid-cols-2">
            <BreakdownCard title="By service (income ledger)" rows={r.byService} />
            <BreakdownCard title="By group of income ledgers in Tally" rows={r.byIncomeGroup} />
            <BreakdownCard title="By voucher type (the names billed under)" rows={r.byVoucherType} />
            <BreakdownCard title="By who brings the client (Sundry Debtors group)" rows={r.byDebtorGroup} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Month by month: FY {r.trendYears.now} and FY {r.trendYears.before}
                {firm === "ALL" ? " (MVC + B Edge)" : ` (${ENTITY_LABELS[firm]})`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SalesTrend trend={r.trend} years={r.trendYears} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium", value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// Up / down with an arrow and a sign, never colour alone
function Growth({ change, pct, className }: { change: number; pct: number | null; className?: string }) {
  const up = change > 0;
  const down = change < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", up && "text-emerald-700 dark:text-emerald-400", down && "text-red-700 dark:text-red-400", className)}>
      <Icon className="h-4 w-4" />
      {pct == null ? (change ? (up ? "new" : "—") : "0%") : `${pct > 0 ? "+" : ""}${pct}%`}
    </span>
  );
}

function Headline({ title, c, strong = false }: { title: string; c: Compared; strong?: boolean }) {
  return (
    <div className={cn("space-y-2 rounded-lg border p-4", strong && "border-primary/50 bg-primary/5")}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-3xl font-bold tabular-nums">{rupees(c.now.sales)}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Growth change={c.change} pct={c.growthPct} className="text-base" />
        <span className="text-muted-foreground">
          {c.change >= 0 ? "+" : ""}
          {rupees(c.change)} on {rupees(c.before.sales)} a year before
        </span>
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-0.5 text-left font-normal" />
            <th className="py-0.5 text-right font-normal">Now</th>
            <th className="py-0.5 text-right font-normal">Year before</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-0.5">Bills</td>
            <td className="py-0.5 text-right tabular-nums">{c.now.bills}</td>
            <td className="py-0.5 text-right tabular-nums">{c.before.bills}</td>
          </tr>
          <tr>
            <td className="py-0.5">Average bill</td>
            <td className="py-0.5 text-right tabular-nums">{c.now.avgBill == null ? "—" : rupees(c.now.avgBill)}</td>
            <td className="py-0.5 text-right tabular-nums">{c.before.avgBill == null ? "—" : rupees(c.before.avgBill)}</td>
          </tr>
          <tr>
            <td className="py-0.5">Clients billed</td>
            <td className="py-0.5 text-right tabular-nums">{c.now.parties}</td>
            <td className="py-0.5 text-right tabular-nums">{c.before.parties}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Bridge({ b, counts }: { b: { before: number; fromNew: number; fromLost: number; fromContinuing: number; now: number }; counts: { newCount: number; lostCount: number; continuingCount: number } }) {
  const steps: [string, number, string][] = [
    ["A year before", b.before, ""],
    [`+ New clients (${counts.newCount})`, b.fromNew, "sign"],
    [`− Not billed this time (${counts.lostCount})`, b.fromLost, "sign"],
    [`± Same clients, more or less (${counts.continuingCount})`, b.fromContinuing, "sign"],
    ["= Now", b.now, ""],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      {steps.map(([label, v, kind]) => (
        <div key={label} className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={cn("text-lg font-bold tabular-nums", kind && v > 0 && "text-emerald-700 dark:text-emerald-400", kind && v < 0 && "text-red-700 dark:text-red-400")}>
            {kind && v > 0 ? "+" : ""}
            {rupees(v)}
          </p>
        </div>
      ))}
    </div>
  );
}

function ClientList({ title, note, rows, show }: { title: string; note: string; rows: ClientRow[]; show: "now" | "before" | "change" }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({note})</span>
      </p>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="py-1 text-muted-foreground">None</td>
            </tr>
          )}
          {rows.map((c) => (
            <tr key={c.party} className="border-b">
              <td className="py-1">
                {c.party}
                {c.firms.length > 0 && <span className="text-xs text-muted-foreground"> · {c.firms.join(", ")}</span>}
              </td>
              <td className="py-1 text-right tabular-nums">
                {show === "change" ? (
                  <span className={c.change >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                    {c.change > 0 ? "+" : ""}
                    {rupees(c.change)}
                  </span>
                ) : (
                  rupees(show === "now" ? c.now : c.before)
                )}
              </td>
              {show === "change" && (
                <td className="py-1 pl-3 text-right text-xs tabular-nums text-muted-foreground">
                  {rupees(c.before)} → {rupees(c.now)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, 12);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Biggest change first</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-y text-left">
              <th className="px-2 py-1">Name</th>
              <th className="px-2 py-1 text-right">Now</th>
              <th className="px-2 py-1 text-right">Year before</th>
              <th className="px-2 py-1 text-right">Change</th>
              <th className="px-2 py-1 text-right">Growth</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">
                  No sales in either period
                </td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.name} className="border-b">
                <td className="px-2 py-1">{r.name}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{rupees(r.now)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{rupees(r.before)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                  {r.change > 0 ? "+" : ""}
                  {rupees(r.change)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  <Growth change={r.change} pct={r.growthPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 12 && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

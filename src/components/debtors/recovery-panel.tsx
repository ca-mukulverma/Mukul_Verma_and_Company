"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { FileText, MessageCircle, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { cn } from "@/lib/utils";
import { asOfText, DEBTOR_ENTITIES, ENTITY_LABELS, istToday, tallyDate, type DebtorEntity } from "@/lib/tally-debtors-shared";
import { addMonths, monthBounds, type MonthFigures, type Recovery } from "@/lib/tally-recovery";
import type { RecoveryAnswer } from "@/lib/tally-debtors";
import { RecoveryTrend, rupees } from "./recovery-trend";

// Recovery (docs/TALLY_DEBTORS.md): for each firm separately, a month's dues,
// billing and what was recovered (received + TDS), with the last 12 months,
// Tally's groups, whom to chase, and what the follow-ups (WhatsApp or email) brought.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export function useRecovery(entity: DebtorEntity, month: string, reloadKey: number) {
  const [data, setData] = useState<RecoveryAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    axios
      .get<RecoveryAnswer>("/api/debtors/recovery", { params: { entity, month } })
      .then(({ data }) => !cancelled && (setData(data), setError(null)))
      .catch((e) => !cancelled && setError(apiError(e, "Could not work out the recovery")));
    return () => {
      cancelled = true;
    };
  }, [entity, month, reloadKey]);
  return { data, error };
}

// The months to choose from: this one back to the first kept month (at most 24)
export function MonthPicker({ value, onChange, firstMonth }: { value: string; onChange: (m: string) => void; firstMonth: string | null }) {
  const current = istToday().slice(0, 7);
  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 24; i++) {
      const m = addMonths(current, -i);
      if (firstMonth && m < firstMonth) break;
      out.push(m);
    }
    return out;
  }, [current, firstMonth]);
  return (
    <div className="space-y-1">
      <Label>Month</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {monthName(m)}
              {m === current ? " (to date)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Tile({ label, value, note, strong = false }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-bold tabular-nums", strong ? "text-3xl" : "text-xl")}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function periodNote(m: MonthFigures) {
  return `${tallyDate(m.from)} to ${tallyDate(m.to)}${m.to < monthBounds(m.month).to ? " (to date)" : ""}`;
}

// The month in tiles and a short statement (used for one firm, and for both side by side)
export function MonthSummary({ m, title }: { m: MonthFigures; title?: string }) {
  return (
    <div className="space-y-3">
      {title && <p className="text-base font-semibold">{title}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Recovery %" value={pct(m.recoveryPct)} note="recovered ÷ (dues at start + billed)" strong />
        <Tile label="Recovered" value={rupees(m.recovered)} note={`received ${rupees(m.received)} + TDS ${rupees(m.tds)}`} />
        <Tile label="Dues now" value={rupees(m.closingDue)} note={`over 90 days ${rupees(m.over90)} (${share(m.over90, m.closingDue)})`} />
        <Tile label="Days to collect" value={m.daysToCollect == null ? "—" : String(m.daysToCollect)} note="dues ÷ last 90 days' billing × 90" />
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b">
            <td className="py-1">Dues at the start ({tallyDate(m.from)})</td>
            <td className="py-1 text-right tabular-nums">{rupees(m.openingDue)}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1">+ Billed in the month</td>
            <td className="py-1 text-right tabular-nums">{rupees(m.billed)}</td>
          </tr>
          {m.otherDebits > 0 && (
            <tr className="border-b">
              <td className="py-1">+ Other debits (refunds, journals)</td>
              <td className="py-1 text-right tabular-nums">{rupees(m.otherDebits)}</td>
            </tr>
          )}
          <tr className="border-b">
            <td className="py-1">− Received</td>
            <td className="py-1 text-right tabular-nums">{rupees(m.received)}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1">− TDS deducted by clients</td>
            <td className="py-1 text-right tabular-nums">{rupees(m.tds)}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1">− Credit notes and other adjustments</td>
            <td className="py-1 text-right tabular-nums">{rupees(m.adjusted)}</td>
          </tr>
          <tr className="border-b font-semibold">
            <td className="py-1">Dues at the end ({tallyDate(m.to)})</td>
            <td className="py-1 text-right tabular-nums">{rupees(m.closingDue)}</td>
          </tr>
          <tr>
            <td className="py-1 text-muted-foreground">Old dues recovered (of the dues at the start)</td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {rupees(m.oldDuesRecovered)} of {rupees(m.openingDue)} ({share(m.oldDuesRecovered, m.openingDue)})
            </td>
          </tr>
          {m.advances > 0 && (
            <tr>
              <td className="py-1 text-muted-foreground">Advances held at the start (credit balances)</td>
              <td className="py-1 text-right tabular-nums text-muted-foreground">{rupees(m.advances)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Ageing({ m }: { m: MonthFigures }) {
  const rows: [string, number][] = [
    ["0–30 days", m.ageing.d0_30],
    ["31–90 days", m.ageing.d31_90],
    ["91–180 days", m.ageing.d91_180],
    ["181–365 days", m.ageing.d181_365],
    ["Over 1 year", m.ageing.over365],
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-y text-left">
          <th className="px-2 py-1">How old the dues are</th>
          <th className="px-2 py-1 text-right">Amount</th>
          <th className="px-2 py-1 text-right">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, v]) => (
          <tr key={label} className="border-b">
            <td className="px-2 py-1">{label}</td>
            <td className="px-2 py-1 text-right tabular-nums">{rupees(v)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{share(v, m.closingDue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// One firm's recovery: summary, trend, groups, whom to chase, follow-ups
export function RecoveryPanel({ entity, month, onMonth, reloadKey }: { entity: DebtorEntity; month: string; onMonth: (m: string) => void; reloadKey: number }) {
  const { data, error } = useRecovery(entity, month, reloadKey);
  const label = ENTITY_LABELS[entity];
  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  const r: Recovery | null = data.recovery;
  if (!r) return <Card><CardContent className="py-8 text-center text-muted-foreground">No data from {label}&apos;s Tally yet.</CardContent></Card>;
  const m = r.month;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5" /> Recovery: {label}
              {data.company ? ` (${data.company})` : ""}, {monthName(month)}
            </CardTitle>
            <CardDescription>
              {periodNote(m)}. As per Tally data of {data.readAt ? asOfText(data.readAt) : "—"}. TDS deducted by clients counts as recovered.
            </CardDescription>
          </div>
          <MonthPicker value={month} onChange={onMonth} firstMonth={data.periodFrom?.slice(0, 7) ?? null} />
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <MonthSummary m={m} />
          <div className="space-y-3">
            <Ageing m={m} />
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">Follow-ups (WhatsApp, email) in {monthName(month)}</p>
              <p>
                Ledgers sent: <b>{r.followUp.sent}</b> · paid within 15 days: <b>{r.followUp.paid}</b>
                {r.followUp.paid > 0 && ` (${rupees(r.followUp.paidAmount)})`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Last 12 months: {label}</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryTrend trend={r.trend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By group in Tally: {monthName(month)}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y text-left">
                <th className="px-2 py-1">Group</th>
                <th className="px-2 py-1 text-right">Dues at start</th>
                <th className="px-2 py-1 text-right">Billed</th>
                <th className="px-2 py-1 text-right">Recovered</th>
                <th className="px-2 py-1 text-right">Recovery %</th>
                <th className="px-2 py-1 text-right">Dues now</th>
                <th className="px-2 py-1 text-right">Over 90 days</th>
              </tr>
            </thead>
            <tbody>
              {r.groups.map((g) => (
                <tr key={g.group} className="border-b">
                  <td className="px-2 py-1 font-medium">{g.group}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(g.openingDue)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(g.billed)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(g.recovered)}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{pct(g.recoveryPct)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(g.closingDue)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(g.over90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Whom to chase: {label}</CardTitle>
          <CardDescription>Dues on {tallyDate(m.to)}, the oldest money first. Red: nothing received for 60 days or more.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y text-left">
                <th className="px-2 py-1">Ledger</th>
                <th className="px-2 py-1">Group</th>
                <th className="px-2 py-1 text-right">Due</th>
                <th className="px-2 py-1 text-right">Over 90 days</th>
                <th className="px-2 py-1">Last payment</th>
                <th className="px-2 py-1">Ledger last sent</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {r.actions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">
                    Nothing due
                  </td>
                </tr>
              )}
              {r.actions.map((a) => {
                const late = a.daysSinceRecovery == null || a.daysSinceRecovery >= 60;
                return (
                  <tr key={a.id} className="border-b">
                    <td className="px-2 py-1 font-medium">
                      <Link href={`/dashboard/debtors/${a.id}`} className="text-primary underline-offset-2 hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{a.group}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{rupees(a.due)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{a.over90 ? rupees(a.over90) : "—"}</td>
                    <td className={cn("px-2 py-1", late && "font-medium text-red-700 dark:text-red-400")}>
                      {a.lastRecoveredDate ? `${tallyDate(a.lastRecoveredDate)} (${a.daysSinceRecovery} days)` : "None in the kept period"}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{a.lastSentAt ? asOfText(a.lastSentAt).split(",")[0] : "—"}</td>
                    <td className="px-2 py-1">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/dashboard/debtors/${a.id}`} aria-label={`Open ${a.name}'s ledger`}>
                            <FileText className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" asChild>
                          <Link href={`/dashboard/debtors/${a.id}?send=whatsapp`} aria-label={`Send ${a.name}'s ledger on WhatsApp`}>
                            <MessageCircle className="mr-1 h-4 w-4" /> WhatsApp
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// Both firms side by side for a month (each from its own Tally data)
export function RecoveryCompare({ month, onMonth, reloadKey }: { month: string; onMonth: (m: string) => void; reloadKey: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5" /> Recovery: MVC and B Edge, {monthName(month)}
          </CardTitle>
          <CardDescription>Each firm separately, from its own Tally. Choose MVC or B Edge above for the trend, groups and whom to chase.</CardDescription>
        </div>
        <MonthPicker value={month} onChange={onMonth} firstMonth={null} />
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-2">
        {DEBTOR_ENTITIES.map((e) => (
          <FirmSummary key={e} entity={e} month={month} reloadKey={reloadKey} />
        ))}
      </CardContent>
    </Card>
  );
}

function FirmSummary({ entity, month, reloadKey }: { entity: DebtorEntity; month: string; reloadKey: number }) {
  const { data, error } = useRecovery(entity, month, reloadKey);
  const title = `${ENTITY_LABELS[entity]}${data?.company ? ` (${data.company})` : ""}`;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  if (!data.recovery) return <p className="text-muted-foreground">{title}: no data from Tally yet.</p>;
  return (
    <div className="space-y-1">
      <MonthSummary m={data.recovery.month} title={title} />
      <p className="text-xs text-muted-foreground">As per Tally data of {data.readAt ? asOfText(data.readAt) : "—"}</p>
    </div>
  );
}

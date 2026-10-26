"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AskClaudeButton } from "./ask-claude";
import { apiError, currentMonthKey, rupees, STATUS_LABELS } from "./types";

interface GstRow {
  clientId: string;
  client: string;
  period: string;
  gstr1Status: keyof typeof STATUS_LABELS | null;
  gstr3bStatus: keyof typeof STATUS_LABELS | null;
  gstr1Taxable: number | null;
  gstr3bTaxable: number | null;
  taxableDiff: number | null;
  gstr1Tax: number | null;
  gstr3bTax: number | null;
  taxDiff: number | null;
  itcClaimed: number | null;
  itc2b: number | null;
  itcExcess: number | null;
  rcmExpected: number | null;
  rcmPaid: number | null;
  rcmShort: number | null;
  cashPaid: number | null;
  flags: string[];
}

interface ClientReco {
  gst: GstRow[];
  gstTotals: Record<string, number | null>;
  tds: { period: string; returnName: string; status: keyof typeof STATUS_LABELS; challanTotal: number; deducted: number | null; deposited: number | null; diff: number | null }[];
}

function Diff({ value, bad }: { value: number | null; bad?: (v: number) => boolean }) {
  if (value === null) return <span className="text-muted-foreground">–</span>;
  const isBad = bad ? bad(value) : Math.abs(value) >= 1;
  return <span className={cn(isBad ? "font-semibold text-red-600" : "text-emerald-700 dark:text-emerald-400")}>{isBad ? rupees(value) : "✓"}</span>;
}

const cell = (v: number | null) => (v === null ? <span className="text-muted-foreground">–</span> : rupees(v));

function fyOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

// Reconciliation from the figures staff enter when they mark returns filed.
// Worked out by the app itself (no AI), so it is always free and live.
export function ComplianceReco({ isManager }: { isManager: boolean }) {
  const [clients, setClients] = useState<{ id: string; name: string; gstin: string | null }[]>([]);
  const [clientId, setClientId] = useState("");
  const [fy, setFy] = useState(fyOf(currentMonthKey()));
  const [data, setData] = useState<ClientReco | null>(null);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(currentMonthKey());
  const [mismatches, setMismatches] = useState<GstRow[] | null>(null);

  useEffect(() => {
    axios.get("/api/compliance/clients").then(({ data }) => setClients(data.clients.filter((c: { works: unknown[] }) => c.works.length > 0))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    axios
      .get("/api/compliance/reco", { params: { clientId, fy } })
      .then(({ data }) => setData(data))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [clientId, fy]);

  useEffect(() => {
    setMismatches(null);
    axios
      .get("/api/compliance/reco", { params: { month } })
      .then(({ data }) => setMismatches(data.rows))
      .catch((e) => toast.error(apiError(e)));
  }, [month]);

  const client = clients.find((c) => c.id === clientId);
  const fyLabel = `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Problems in GST returns of the month</p>
            <Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          {isManager && (
            <AskClaudeButton
              label="Ask Claude to explain"
              question={`Look at the GST returns for the period ending ${month} across all clients and explain the mismatches between GSTR-1 (+1A) and GSTR-3B, ITC claimed above GSTR-2B and RCM not paid, with the likely reason for each.`}
            />
          )}
        </div>
        {mismatches === null ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : mismatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No mismatches found in the figures entered for this month.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {mismatches.map((r) => (
              <li key={`${r.clientId}-${r.period}`} className="rounded-md border p-2">
                <button className="font-medium hover:underline" onClick={() => { setClientId(r.clientId); setFy(fyOf(month)); }}>{r.client}</button>{" "}
                <span className="text-muted-foreground">{r.period}</span>
                <ul className="ml-4 list-disc text-red-700 dark:text-red-400">
                  {r.flags.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Client</p>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Financial year</p>
            <Select value={String(fy)} onValueChange={(v) => setFy(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3].map((i) => {
                  const y = fyOf(currentMonthKey()) - i;
                  return <SelectItem key={y} value={String(y)}>FY {y}-{String((y + 1) % 100).padStart(2, "0")}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          {isManager && client && (
            <AskClaudeButton
              label="Ask Claude for a summary"
              question={`Make a GST and TDS reconciliation summary for "${client.name}"${client.gstin ? ` (GSTIN ${client.gstin})` : ""} for FY ${fyLabel}, period by period, and tell me what needs attention.`}
            />
          )}
        </div>

        {!clientId ? (
          <p className="text-sm text-muted-foreground">Choose a client to see their year.</p>
        ) : loading || !data ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left">
                  <tr>
                    {["Period", "GSTR-1 (+1A) taxable", "3B taxable", "Diff", "GSTR-1 tax", "3B tax", "Diff", "ITC claimed", "GSTR-2B ITC", "Excess", "RCM lines", "RCM paid", "Short", "Cash paid", "Status"].map((h, i) => (
                      <th key={h + i} className="whitespace-nowrap p-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.gst.length === 0 ? (
                    <tr><td colSpan={15} className="p-4 text-center text-muted-foreground">No GST returns this year.</td></tr>
                  ) : (
                    data.gst.map((r) => (
                      <tr key={r.period} className="border-t">
                        <td className="whitespace-nowrap p-2 font-medium">{r.period}</td>
                        <td className="p-2">{cell(r.gstr1Taxable)}</td>
                        <td className="p-2">{cell(r.gstr3bTaxable)}</td>
                        <td className="p-2"><Diff value={r.taxableDiff} /></td>
                        <td className="p-2">{cell(r.gstr1Tax)}</td>
                        <td className="p-2">{cell(r.gstr3bTax)}</td>
                        <td className="p-2"><Diff value={r.taxDiff} /></td>
                        <td className="p-2">{cell(r.itcClaimed)}</td>
                        <td className="p-2">{cell(r.itc2b)}</td>
                        <td className="p-2"><Diff value={r.itcExcess} bad={(v) => v >= 1} /></td>
                        <td className="p-2">{cell(r.rcmExpected)}</td>
                        <td className="p-2">{cell(r.rcmPaid)}</td>
                        <td className="p-2"><Diff value={r.rcmShort} bad={(v) => v >= 1} /></td>
                        <td className="p-2">{cell(r.cashPaid)}</td>
                        <td className="whitespace-nowrap p-2">
                          {r.gstr1Status ? `1: ${STATUS_LABELS[r.gstr1Status]}` : ""} {r.gstr3bStatus ? `· 3B: ${STATUS_LABELS[r.gstr3bStatus]}` : ""}
                        </td>
                      </tr>
                    ))
                  )}
                  {data.gst.length > 0 && (
                    <tr className="border-t bg-muted/50 font-semibold">
                      <td className="p-2">Total</td>
                      <td className="p-2">{cell(data.gstTotals.gstr1Taxable)}</td>
                      <td className="p-2">{cell(data.gstTotals.gstr3bTaxable)}</td>
                      <td className="p-2" />
                      <td className="p-2">{cell(data.gstTotals.gstr1Tax)}</td>
                      <td className="p-2">{cell(data.gstTotals.gstr3bTax)}</td>
                      <td className="p-2" />
                      <td className="p-2">{cell(data.gstTotals.itcClaimed)}</td>
                      <td className="p-2">{cell(data.gstTotals.itc2b)}</td>
                      <td className="p-2" />
                      <td className="p-2">{cell(data.gstTotals.rcmExpected)}</td>
                      <td className="p-2">{cell(data.gstTotals.rcmPaid)}</td>
                      <td className="p-2" />
                      <td className="p-2">{cell(data.gstTotals.cashPaid)}</td>
                      <td className="p-2" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left">
                  <tr>
                    {["Quarter", "Return", "Challans paid", "TDS deducted", "TDS deposited (return)", "Diff", "Status"].map((h) => (
                      <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.tds.length === 0 ? (
                    <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No TDS returns this year.</td></tr>
                  ) : (
                    data.tds.map((r) => (
                      <tr key={r.period + r.returnName} className="border-t">
                        <td className="whitespace-nowrap p-2">{r.period}</td>
                        <td className="p-2">{r.returnName}</td>
                        <td className="p-2">{rupees(r.challanTotal)}</td>
                        <td className="p-2">{cell(r.deducted)}</td>
                        <td className="p-2">{cell(r.deposited)}</td>
                        <td className="p-2"><Diff value={r.diff} /></td>
                        <td className="p-2">{STATUS_LABELS[r.status]}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Diff = GSTR-3B minus GSTR-1, or return minus challans. Figures come from what staff enter when marking a return filed; empty figures show as –.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

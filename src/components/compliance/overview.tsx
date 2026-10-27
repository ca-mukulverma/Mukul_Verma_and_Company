"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AskClaudeButton } from "./ask-claude";
import { apiError } from "./types";

interface Overview {
  isManager: boolean;
  works: {
    id: string;
    name: string;
    kind: string;
    team: string[];
    mine: boolean;
    overdue: number;
    dueSoon: number;
    pending: number;
    dataReceived: number;
    docsPending: number;
    completedThisMonth: number;
  }[];
  notes: { id: string; body: string; createdAt: string; client: { id: string; name: string } | null }[];
  email: { sentToday: number; limit: number; mvc: boolean; bedge: boolean };
  storageReady: boolean;
  // Admins and Partners: filings in the last 90 days per person
  signOffs: { name: string; total: number; selfChecked: number }[];
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" | "sky" | "green" }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p
        className={cn(
          "text-lg font-semibold",
          value > 0 && tone === "red" && "text-red-600",
          value > 0 && tone === "amber" && "text-amber-600",
          value > 0 && tone === "sky" && "text-sky-600",
          value > 0 && tone === "green" && "text-emerald-600"
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function ComplianceOverview({ onOpenSheet }: { onOpenSheet: (kind: string, workTypeId: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get("/api/compliance/overview")
      .then(({ data }) => setData(data))
      .catch((e) => setError(apiError(e, "Could not load the overview")));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <Loader2 className="mx-auto mt-8 h-6 w-6 animate-spin" />;

  const works = [...data.works].sort((a, b) => Number(b.mine) - Number(a.mine));
  return (
    <div className="space-y-4">
      {!data.storageReady && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          File storage (Cloudflare R2) is not set up yet, so return PDFs and other files can&apos;t be uploaded. The steps are in docs/COMPLIANCE.md.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Emails sent today (reminders, files and bills): {data.email.sentToday} of about {data.email.limit} allowed by Gmail.
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {works.map((w) => (
          <Card key={w.id} className={cn(w.mine && "border-primary")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <button className="text-left hover:underline" onClick={() => onOpenSheet(w.kind, w.id)}>
                  {w.name}
                </button>
                {w.mine && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">My work</span>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Team: {w.team.length ? w.team.join(", ") : "not set (everyone)"}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
              <Stat label="Overdue" value={w.overdue} tone="red" />
              <Stat label="Due in 7 days" value={w.dueSoon} tone="amber" />
              <Stat label="Data pending" value={w.pending} />
              <Stat label="Data received" value={w.dataReceived} tone="amber" />
              <Stat label="Files pending" value={w.docsPending} tone="sky" />
              <Stat label="Done this month" value={w.completedThisMonth} tone="green" />
            </CardContent>
          </Card>
        ))}
      </div>

      {data.isManager && data.signOffs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Completed and self-checked (last 90 days)</CardTitle>
            <p className="text-xs text-muted-foreground">Returns filed and TDS months closed by each person, and how many of them nobody else checked.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-1">Completed by</th>
                    <th className="p-1 text-right">Total</th>
                    <th className="p-1 text-right">Self-checked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signOffs.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="p-1">{p.name}</td>
                      <td className="p-1 text-right">{p.total}</td>
                      <td className={cn("p-1 text-right", p.total > 0 && p.selfChecked / p.total > 0.8 && "font-medium text-amber-700 dark:text-amber-300")}>
                        {p.selfChecked} ({Math.round((p.selfChecked / p.total) * 100)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {data.isManager && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Claude&apos;s notes</span>
              <AskClaudeButton
                label="Ask Claude for a firm summary"
                question="Give me a summary of this month's compliance work across all clients: what is filed, what is pending or overdue by work, GST mismatches (GSTR-1 vs GSTR-3B, ITC vs GSTR-2B, RCM), and TDS returns whose deposited amount differs from the challans."
              />
            </CardTitle>
            <p className="text-xs text-muted-foreground">Only Admins and Partners see this. Notes come from Claude&apos;s nightly review on your Claude plan.</p>
          </CardHeader>
          <CardContent>
            {data.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet. They appear here once the nightly review is set up (see docs/COMPLIANCE.md).</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.notes.map((n) => (
                  <li key={n.id} className="rounded-md border p-2">
                    <p className="text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      {n.client ? ` · ${n.client.name}` : ""}
                    </p>
                    <p className="whitespace-pre-line">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

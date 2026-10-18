"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BILL_TYPE_LABELS, BillTypeValue, formatRupees } from "@/lib/billing-constants";
import { apiErrorMessage, blobErrorMessage, downloadBillFile } from "./bill-types";

interface Series {
  type: BillTypeValue;
  ledgers: {
    company: string;
    voucherType: string;
    salesLedger: string;
    cgstLedger: string;
    sgstLedger: string;
    igstLedger: string;
  };
  ledgersSet: boolean;
  bills: { id: string; billNumber: string; action: "Create" | "Alter" | "Cancel"; client: string | null; amount: number | null }[];
  // clientId is null for names entered under "Other"
  parties: { clientId: string | null; clientName: string; ledgerName: string; custom: boolean }[];
  history: { id: string; createdAt: string; newCount: number; updateCount: number; createdBy: { name: string } }[];
}

const ACTION_LABELS = { Create: "New", Alter: "Changed", Cancel: "Cancelled" } as const;

// Billing managers send approved bills to Tally as an XML file per company
export function TallyExport({ isAdmin }: { isAdmin: boolean }) {
  const [series, setSeries] = useState<Series[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await axios.get<{ series: Series[] }>("/api/billing/tally");
      setSeries(response.data.series);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load the Tally export"));
      setSeries([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (series === null) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each file goes into its own company in Tally: in TallyPrime choose <strong>Import → Vouchers</strong> and
        select the file. Bills in a downloaded file are marked as sent; if the import fails, download the same file
        again from the history below.
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        {series.map((s) => (
          <SeriesCard key={s.type} series={s} isAdmin={isAdmin} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

function SeriesCard({ series, isAdmin, onChanged }: { series: Series; isAdmin: boolean; onChanged: () => void }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const newCount = series.bills.filter((b) => b.action === "Create").length;
  const changeCount = series.bills.length - newCount;
  const isGst = series.type === "GST";

  const download = async (key: string, request: Parameters<typeof downloadBillFile>[0]) => {
    setDownloading(key);
    try {
      await downloadBillFile(request);
      if (key === "export") {
        toast.success("Tally file downloaded; these bills are marked as sent");
        onChanged();
      }
    } catch (error) {
      toast.error(await blobErrorMessage(error));
      if (key === "export") onChanged();
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{BILL_TYPE_LABELS[series.type]}</CardTitle>
        <CardDescription>Tally company: {series.ledgers.company}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!series.ledgersSet && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Tally names are not set yet, so the defaults below are used.{" "}
              {isAdmin ? "Set them in Company profiles." : "Admin sets them in Company profiles."}
            </span>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Voucher type</dt>
          <dd>{series.ledgers.voucherType}</dd>
          <dt className="text-muted-foreground">Fee ledger</dt>
          <dd>{series.ledgers.salesLedger}</dd>
          {isGst && (
            <>
              <dt className="text-muted-foreground">GST ledgers</dt>
              <dd>
                {series.ledgers.cgstLedger}, {series.ledgers.sgstLedger}, {series.ledgers.igstLedger}
              </dd>
            </>
          )}
        </dl>

        <div className="space-y-2">
          <p className="font-medium">
            Waiting to go to Tally: {series.bills.length === 0 ? "nothing" : `${newCount} new${changeCount ? `, ${changeCount} changed or cancelled` : ""}`}
          </p>
          {series.bills.length > 0 && (
            <ul className="max-h-56 overflow-y-auto divide-y rounded-md border text-sm">
              {series.bills.map((bill) => (
                <li key={bill.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="font-mono shrink-0">{bill.billNumber}</span>
                  <span className="truncate text-muted-foreground flex-1">{bill.client}</span>
                  {bill.action !== "Create" && <Badge variant="outline">{ACTION_LABELS[bill.action]}</Badge>}
                  {bill.amount !== null && <span className="shrink-0">{formatRupees(bill.amount)}</span>}
                </li>
              ))}
            </ul>
          )}
          <Button
            className="w-full"
            disabled={series.bills.length === 0 || downloading !== null}
            onClick={() => download("export", { method: "post", url: "/api/billing/tally", data: { type: series.type } })}
          >
            {downloading === "export" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download Tally XML
          </Button>
        </div>

        {series.parties.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">Client ledgers in Tally</p>
            <p className="text-xs text-muted-foreground">
              Each client&apos;s ledger must already exist in Tally under exactly this name. Change it here if the name in
              Tally is different.
            </p>
            {series.parties.map((party) =>
              party.clientId ? (
                <PartyLedger key={party.clientId} party={party} onSaved={onChanged} />
              ) : (
                <div key={`other-${party.clientName}`} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{party.clientName} (Other – not a saved client)</p>
                  <p className="rounded-md border px-3 py-2 text-sm">{party.ledgerName}</p>
                </div>
              )
            )}
          </div>
        )}

        {series.history.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">Earlier files</p>
            <ul className="divide-y rounded-md border text-sm">
              {series.history.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="flex-1 min-w-0">
                    {format(new Date(item.createdAt), "d MMM yyyy, h:mm a")}
                    <span className="block text-xs text-muted-foreground truncate">
                      {item.newCount} new{item.updateCount ? `, ${item.updateCount} changed` : ""} · {item.createdBy.name}
                    </span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="Download this file again"
                    disabled={downloading !== null}
                    onClick={() => download(item.id, { method: "get", url: `/api/billing/tally/${item.id}` })}
                  >
                    {downloading === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PartyLedger({ party, onSaved }: { party: Series["parties"][number]; onSaved: () => void }) {
  const [value, setValue] = useState(party.ledgerName);
  const [saving, setSaving] = useState(false);
  const changed = value.trim() !== party.ledgerName;

  const save = async () => {
    setSaving(true);
    try {
      // Saving the client's own name clears the custom ledger name
      const name = value.trim() === party.clientName ? "" : value.trim();
      await axios.put("/api/billing/tally/ledgers", { clientId: party.clientId, tallyLedgerName: name });
      toast.success("Ledger name saved");
      onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{party.clientName}</p>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Tally ledger for ${party.clientName}`} />
        <Button size="icon" variant="outline" disabled={!changed || !value.trim() || saving} onClick={save} aria-label="Save ledger name">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, BookOpen, Download, Loader2, Save, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BILL_TYPE_LABELS, BillTypeValue, formatRupees } from "@/lib/billing-constants";
import { apiErrorMessage, blobErrorMessage, downloadBillFile, runBillAction } from "./bill-types";
import { IncomeLedgerFields } from "./income-ledger-picker";
import { TallyServices } from "./tally-services";
import { TallySendDialog } from "./tally-send";
import { TallyLedgerFile } from "./tally-ledger-file";
import { PendingLedgers } from "./pending-ledgers";

interface Series {
  type: BillTypeValue;
  ledgers: {
    company: string;
    voucherType: string;
    fallbackIncomeLedger: string | null;
    cgstLedger: string;
    sgstLedger: string;
    igstLedger: string;
  };
  ledgersSet: boolean;
  bills: WaitingBill[];
  // clientId is null for names entered under "Other"
  parties: { clientId: string | null; clientName: string; ledgerName: string; custom: boolean; connectorName?: string }[];
  history: { id: string; createdAt: string; newCount: number; updateCount: number; createdBy: { name: string } }[];
}

interface WaitingBill {
  id: string;
  billNumber: string;
  action: "Create" | "Alter" | "Cancel";
  client: string | null;
  amount: number | null;
  incomeLedgerId: string | null;
  // The ledger it goes to (its own, or the profile's fallback); null: not set
  incomeLedger: string | null;
  lineDescription: string;
  savedLineDescription: string | null;
  // False: waits until its income ledger is set
  ready: boolean;
  // Tally's reason the last time it refused the bill
  tallyError: string | null;
}

const ACTION_LABELS = { Create: "New", Alter: "Changed", Cancel: "Cancelled" } as const;

// Billing managers send approved bills to Tally as an XML file per company
export function TallyExport({ isAdmin }: { isAdmin: boolean }) {
  const [series, setSeries] = useState<Series[] | null>(null);
  // Bumped to reload the clients waiting for a ledger
  const [ledgersVersion, setLedgersVersion] = useState(0);

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
        <strong>Import into Tally</strong> sends the bills you tick straight into TallyPrime on this computer (with the
        Tally extension), and marks each one as it is taken. Or download the XML and, in TallyPrime, choose{" "}
        <strong>Import → Vouchers</strong>: bills in a downloaded file are marked as sent; if that import fails, download
        the same file again from the history below (the latest 10 files are kept).
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <p className="flex-1 min-w-[16rem] text-sm text-muted-foreground">
          Every client&apos;s ledger must exist in Tally under exactly the name used here. To set them all at once,
          download the client list, fill in the names in Excel and upload it.
        </p>
        <TallyLedgerFile
          onSaved={() => {
            load();
            setLedgersVersion((v) => v + 1);
          }}
        />
      </div>
      <PendingLedgers key={ledgersVersion} onSaved={load} />
      <div className="grid gap-4 xl:grid-cols-3">
        {series.map((s) => (
          <SeriesCard key={s.type} series={s} isAdmin={isAdmin} onChanged={load} />
        ))}
      </div>
      <TallyServices />
    </div>
  );
}

function SeriesCard({ series, isAdmin, onChanged }: { series: Series; isAdmin: boolean; onChanged: () => void }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [ledgerFor, setLedgerFor] = useState<WaitingBill | null>(null);
  const [sending, setSending] = useState(false);
  const ready = series.bills.filter((b) => b.ready);
  const newCount = ready.filter((b) => b.action === "Create").length;
  const changeCount = ready.length - newCount;
  const noLedger = series.bills.length - ready.length;
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
              Tally company and voucher type are not set yet, so the defaults below are used.{" "}
              {isAdmin ? "Set them in Company profiles." : "Admin sets them in Company profiles."}
            </span>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Voucher type</dt>
          <dd>{series.ledgers.voucherType}</dd>
          <dt className="text-muted-foreground">Income ledger</dt>
          <dd>
            The bill&apos;s service ledger
            {series.ledgers.fallbackIncomeLedger && (
              <span className="text-muted-foreground"> (if not set: {series.ledgers.fallbackIncomeLedger})</span>
            )}
          </dd>
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
            Ready for Tally: {ready.length === 0 ? "nothing" : `${newCount} new${changeCount ? `, ${changeCount} changed or cancelled` : ""}`}
          </p>
          {noLedger > 0 && (
            <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {noLedger} bill{noLedger === 1 ? " has" : "s have"} no income ledger yet and wait{noLedger === 1 ? "s" : ""} until
              it is set. Click <strong>Set ledger</strong> on {noLedger === 1 ? "it" : "each"}.
            </p>
          )}
          {series.bills.length > 0 && (
            <ul className="max-h-56 overflow-y-auto divide-y rounded-md border text-sm">
              {series.bills.map((bill) => (
                <li key={bill.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono shrink-0">{bill.billNumber}</span>
                      <span className="truncate text-muted-foreground">{bill.client}</span>
                    </span>
                    {bill.action !== "Cancel" && (
                      <span className={bill.incomeLedger ? "block truncate text-xs text-muted-foreground" : "block text-xs text-amber-700 dark:text-amber-400"}>
                        {bill.incomeLedger ?? "No income ledger"}
                      </span>
                    )}
                    {bill.tallyError && <span className="block text-xs text-destructive">Tally refused it: {bill.tallyError}</span>}
                  </span>
                  {bill.action !== "Create" && <Badge variant="outline">{ACTION_LABELS[bill.action]}</Badge>}
                  {bill.amount !== null && <span className="shrink-0">{formatRupees(bill.amount)}</span>}
                  {bill.action !== "Cancel" && (
                    <Button
                      size={bill.incomeLedgerId ? "icon" : "sm"}
                      variant={bill.incomeLedgerId ? "ghost" : "outline"}
                      className={bill.incomeLedgerId ? "h-7 w-7 shrink-0" : "h-7 shrink-0"}
                      aria-label={`Tally ledger of ${bill.billNumber}`}
                      onClick={() => setLedgerFor(bill)}
                    >
                      {bill.incomeLedgerId ? <BookOpen className="h-3.5 w-3.5" /> : "Set ledger"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button className="w-full" disabled={ready.length === 0 || downloading !== null} onClick={() => setSending(true)}>
            <Upload className="mr-2 h-4 w-4" />Import into Tally
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={ready.length === 0 || downloading !== null}
            onClick={() => download("export", { method: "post", url: "/api/billing/tally", data: { type: series.type } })}
          >
            {downloading === "export" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download Tally XML instead
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
                  <p className="text-xs text-muted-foreground">
                    {party.connectorName
                      ? `${party.connectorName} (connector – their clients' bills; change it in Connectors)`
                      : `${party.clientName} (Other – not a saved client)`}
                  </p>
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
      {sending && (
        <TallySendDialog
          type={series.type}
          company={series.ledgers.company}
          bills={ready}
          onClose={() => setSending(false)}
          onChanged={onChanged}
        />
      )}
      {ledgerFor && (
        <WaitingBillLedger
          bill={ledgerFor}
          onClose={() => setLedgerFor(null)}
          onSaved={() => {
            setLedgerFor(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

// The income ledger of a bill waiting for Tally
function WaitingBillLedger({ bill, onClose, onSaved }: { bill: WaitingBill; onClose: () => void; onSaved: () => void }) {
  const [ledgerId, setLedgerId] = useState<string | null>(bill.incomeLedgerId);
  const [line, setLine] = useState(bill.savedLineDescription ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!ledgerId) return;
    setSaving(true);
    try {
      await runBillAction(bill.id, { action: "set_income_ledger", incomeLedgerId: ledgerId, lineDescription: line.trim() });
      toast.success("Ledger saved");
      onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tally ledger – {bill.billNumber}</DialogTitle>
          <DialogDescription>{bill.client}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <IncomeLedgerFields
            ledgerId={ledgerId}
            onLedgerChange={setLedgerId}
            description={line}
            onDescriptionChange={setLine}
            descriptionPlaceholder={bill.lineDescription}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!ledgerId || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

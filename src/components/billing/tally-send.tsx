"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { BILL_TYPE_LABELS, BillTypeValue, formatRupees } from "@/lib/billing-constants";
import {
  downloadTallyExtension,
  saveTallyPort,
  SendStep,
  sendBillsToTally,
  tallyExtensionVersion,
  tallyPort,
  tallyStatus,
} from "./tally-extension";

export interface SendableBill {
  id: string;
  billNumber: string;
  client: string | null;
  amount: number | null;
  action: "Create" | "Alter" | "Cancel";
  incomeLedger: string | null;
}

const ACTION_LABELS = { Create: "New", Alter: "Changed", Cancel: "Cancelled" } as const;

// Billing → Tally: send the chosen bills straight into TallyPrime on this
// computer, with the Tally extension. Only on this click; never on its own.
export function TallySendDialog({
  type,
  company,
  bills,
  onClose,
  onChanged,
}: {
  type: BillTypeValue;
  company: string;
  bills: SendableBill[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [installed, setInstalled] = useState<string | null>(null);
  const [checkedInstall, setCheckedInstall] = useState(false);
  const [selected, setSelected] = useState(() => new Set(bills.map((b) => b.id)));
  const [port, setPort] = useState(String(tallyPort()));
  const [step, setStep] = useState<SendStep | null>(null);
  const stopRef = useRef(false);
  const running = step !== null && step.kind !== "stopped" && step.kind !== "finished";

  // The bridge marks the page as soon as it loads; look again in a moment in
  // case this page opened before it
  useEffect(() => {
    const look = () => {
      setInstalled(tallyExtensionVersion());
      setCheckedInstall(true);
    };
    look();
    const timer = setTimeout(look, 600);
    return () => clearTimeout(timer);
  }, []);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536;

  const start = async () => {
    if (!portValid || selected.size === 0) return;
    saveTallyPort(portNumber);
    stopRef.current = false;
    await sendBillsToTally(type, [...selected], setStep, () => stopRef.current);
    onChanged();
  };

  const testConnection = async () => {
    if (!portValid) return;
    saveTallyPort(portNumber);
    const answer = await tallyStatus();
    if (!answer.ok) return toast.error(answer.error ?? "Tally isn't answering");
    const open = answer.companies ?? [];
    if (open.some((c) => c.trim().toLowerCase() === company.trim().toLowerCase())) toast.success(`Tally is running with ${company} open`);
    else toast.warning(`Tally is running, but ${company} isn't open.${open.length ? ` Open now: ${open.join(", ")}` : ""}`);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import into Tally – {BILL_TYPE_LABELS[type]}</DialogTitle>
          <DialogDescription>
            Sends the ticked bills into <strong>{company}</strong> in TallyPrime on this computer. Tally must be open
            with that company loaded.
          </DialogDescription>
        </DialogHeader>

        {!checkedInstall ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !installed ? (
          <InstallSteps />
        ) : step?.kind === "finished" ? (
          <Results step={step} />
        ) : step?.kind === "stopped" ? (
          <Stopped step={step} />
        ) : running ? (
          <Running step={step!} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="tally-all"
                checked={selected.size === bills.length ? true : selected.size === 0 ? false : "indeterminate"}
                onCheckedChange={(v) => setSelected(v === true ? new Set(bills.map((b) => b.id)) : new Set())}
              />
              <Label htmlFor="tally-all">
                {selected.size} of {bills.length} bill{bills.length === 1 ? "" : "s"} ticked
              </Label>
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y rounded-md border text-sm">
              {bills.map((bill) => (
                <li key={bill.id} className="flex items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    aria-label={`Send ${bill.billNumber}`}
                    checked={selected.has(bill.id)}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v === true) next.add(bill.id);
                      else next.delete(bill.id);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex gap-2">
                      <span className="font-mono shrink-0">{bill.billNumber}</span>
                      <span className="truncate text-muted-foreground">{bill.client}</span>
                    </span>
                    {bill.action !== "Cancel" && <span className="block truncate text-xs text-muted-foreground">{bill.incomeLedger}</span>}
                  </span>
                  {bill.action !== "Create" && <span className="text-xs text-muted-foreground">{ACTION_LABELS[bill.action]}</span>}
                  {bill.amount !== null && <span className="shrink-0">{formatRupees(bill.amount)}</span>}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="tally-port" className="text-xs">Tally port</Label>
                <Input id="tally-port" className="h-8 w-24" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <Button type="button" size="sm" variant="outline" disabled={!portValid} onClick={testConnection}>
                Test connection
              </Button>
              <p className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
                Before sending, the app checks that every voucher type and ledger these bills need is in Tally. If one is
                missing, nothing is sent.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => (stopRef.current = true)}>
              Stop after this bill
            </Button>
          ) : step?.kind === "finished" || step?.kind === "stopped" ? (
            <>
              {step.kind === "stopped" && (
                <Button variant="outline" onClick={() => setStep(null)}>
                  Back
                </Button>
              )}
              <Button onClick={onClose}>Close</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              {installed && (
                <Button disabled={selected.size === 0 || !portValid} onClick={start}>
                  <Upload className="mr-2 h-4 w-4" />Import {selected.size} into Tally
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Running({ step }: { step: SendStep }) {
  const text =
    step.kind === "preparing"
      ? "Preparing the bills…"
      : step.kind === "checking"
        ? `Checking ${step.company} in Tally: voucher types and ledgers…`
        : step.kind === "sending"
          ? `Sending ${step.current} (${step.done + 1} of ${step.total})…`
          : "";
  return (
    <div className="space-y-3 py-2">
      <p className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {text}
      </p>
      {step.kind === "sending" && <Progress value={(step.done / step.total) * 100} />}
      <p className="text-xs text-muted-foreground">Keep this page and Tally open until it finishes.</p>
    </div>
  );
}

function Stopped({ step }: { step: Extract<SendStep, { kind: "stopped" }> }) {
  return (
    <div className="space-y-3">
      <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
        <span>{step.reason}</span>
      </p>
      {!!step.missingVoucherTypes?.length && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Voucher types missing in Tally</p>
          <ul className="list-disc pl-5 text-sm">
            {step.missingVoucherTypes.map((n) => (
              <li key={n}><span className="font-mono">{n}</span> – create it under Sales, numbering Manual</li>
            ))}
          </ul>
        </div>
      )}
      {!!step.missingLedgers?.length && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Ledgers missing in Tally</p>
          <ul className="max-h-48 overflow-y-auto list-disc pl-5 text-sm">
            {step.missingLedgers.map((n) => (
              <li key={n} className="font-mono">{n}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Create them in Tally with exactly these names, or correct the name in the app (client ledger on the Tally
            tab, income ledger in Services).
          </p>
        </div>
      )}
    </div>
  );
}

function Results({ step }: { step: Extract<SendStep, { kind: "finished" }> }) {
  const ok = step.results.filter((r) => r.ok);
  const failed = step.results.filter((r) => !r.ok);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <strong>{ok.length}</strong> in Tally{failed.length ? <>, <strong>{failed.length}</strong> refused</> : null}.
        {step.skipped > 0 && ` ${step.skipped} could not be sent (already sent, or no income ledger).`}
      </p>
      {step.unsaved.length > 0 && (
        <p className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Check these in Tally before sending them again; Tally may have them even though the app could not record
            it: <strong>{step.unsaved.join(", ")}</strong>.
          </span>
        </p>
      )}
      <ul className="max-h-72 overflow-y-auto divide-y rounded-md border text-sm">
        {step.results.map((r) => (
          <li key={r.billId} className="flex gap-2 px-2 py-1.5">
            {r.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />}
            <span className="min-w-0 flex-1">
              <span className="flex gap-2">
                <span className="font-mono shrink-0">{r.billNumber}</span>
                <span className="truncate text-muted-foreground">{r.client}</span>
              </span>
              {!r.ok && r.error && <span className="block text-xs text-destructive">{r.error}</span>}
            </span>
          </li>
        ))}
      </ul>
      {failed.length > 0 && (
        <p className="text-xs text-muted-foreground">Refused bills stay waiting on the Tally tab with Tally&apos;s reason.</p>
      )}
    </div>
  );
}

function InstallSteps() {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadTallyExtension();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download the extension");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="space-y-3 text-sm">
      <p>
        The <strong>Tally extension</strong> isn&apos;t installed in this browser. Install it once, on the computer where
        TallyPrime runs, in Chrome or Edge.
      </p>
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} Download the extension
          </Button>
        </li>
        <li>
          Right-click the ZIP → <span className="font-medium">Extract all</span>, for example into Documents. You get a
          folder <span className="font-mono">mvc-tally</span> with three files.
        </li>
        <li>
          Open <span className="font-mono">chrome://extensions</span> (Edge: <span className="font-mono">edge://extensions</span>), turn on{" "}
          <span className="font-medium">Developer mode</span>, click <span className="font-medium">Load unpacked</span> and choose the{" "}
          <span className="font-mono">mvc-tally</span> folder.
        </li>
        <li>
          In TallyPrime: <span className="font-medium">F1 → Settings → Connectivity → Client/Server configuration</span>:
          TallyPrime acts as <span className="font-medium">Server</span> (or Both), port <span className="font-medium">9000</span>. Restart TallyPrime.
        </li>
        <li>Reload this page and click Import into Tally again.</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        The extension only talks to Tally on this computer and only for this app. It sends bills only; it never creates
        ledgers or voucher types.
      </p>
    </div>
  );
}

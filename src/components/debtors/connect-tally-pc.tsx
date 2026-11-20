"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Download, Loader2, Monitor, PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiError } from "@/components/compliance/types";
import {
  downloadTallyExtension,
  extensionCanSync,
  saveTallyPort,
  syncConnect,
  syncDisconnect,
  syncInfo,
  syncNow,
  SyncInfo,
  tallyExtensionVersion,
  tallyPort,
  tallyStatus,
} from "@/components/billing/tally-extension";
import { TALLY_MVC_COMPANY } from "@/lib/billing-constants";
import { agoText } from "@/lib/tally-debtors-shared";

export interface SyncSetup {
  company: string;
  connected: boolean;
  keyHint: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
}

// Admin, on the PC where TallyPrime runs: connects that PC so its Tally
// extension sends the Sundry Debtors to the app (docs/TALLY_DEBTORS.md)
export function ConnectTallyPc({ setup, onChanged }: { setup: SyncSetup | null; onChanged: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [company, setCompany] = useState(setup?.company ?? TALLY_MVC_COMPANY);
  const [port, setPort] = useState(String(tallyPort()));
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);

  // The bridge marks the page as soon as it loads; look again in a moment
  useEffect(() => {
    const look = () => {
      const v = tallyExtensionVersion();
      setVersion(v);
      if (extensionCanSync(v)) syncInfo().then(setInfo).catch(() => undefined);
    };
    look();
    const t = setTimeout(look, 800);
    return () => clearTimeout(t);
  }, []);

  const thisPcSends = !!info?.connected;

  const connect = async () => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return toast.error("The Tally port is a number such as 9000");
    setBusy("connect");
    try {
      saveTallyPort(p);
      const status = await tallyStatus();
      if (!status.ok) throw new Error(status.error);
      if (!status.companies?.some((c) => c.trim().toLowerCase() === company.trim().toLowerCase())) {
        throw new Error(`"${company}" is not open in TallyPrime. Open now: ${status.companies?.join(", ") || "none"}.`);
      }
      const { data } = await axios.post<{ key: string; company: string }>("/api/debtors/connect", { company: company.trim() });
      const saved = await syncConnect(data.key, data.company);
      if (!saved.ok) throw new Error(saved.error);
      toast.success("This PC is connected. Reading the debtors from Tally now…");
      setBusy("sync");
      const result = await syncNow();
      if (!result.ok) throw new Error(result.error);
      toast.success(`Sent ${result.ledgers} debtor ledgers from Tally`);
      setInfo(await syncInfo());
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error, "Could not connect this PC"), { duration: 10_000 });
      syncInfo().then(setInfo).catch(() => undefined);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const sendNow = async () => {
    setBusy("sync");
    try {
      const result = await syncNow();
      if (!result.ok) throw new Error(result.error);
      toast.success(`Sent from Tally: ${result.ledgers} ledgers, ${result.changed} changed`);
      setInfo(await syncInfo());
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read Tally", { duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!confirm("Stop the Tally PC sending debtors? The debtors already in the app stay; Refresh now and the scheduled updates stop until it is connected again.")) return;
    setBusy("disconnect");
    try {
      await axios.delete("/api/debtors/connect");
      if (extensionCanSync(version)) await syncDisconnect();
      toast.success("The Tally PC is disconnected");
      setInfo(null);
      onChanged();
    } catch (error) {
      toast.error(apiError(error, "Could not disconnect"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Monitor className="h-5 w-5" /> Tally PC (Admin)
        </CardTitle>
        <CardDescription>
          The PC where TallyPrime runs sends the Sundry Debtors ledgers (only those) at 11:30 am, 1:00 pm, 4:00 pm and 7:00 pm and on
          Refresh now, through the MV Company Tally extension in Chrome. Keep Chrome and TallyPrime (with the company open) running on it
          during office hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {setup?.connected ? (
          <p>
            Connected for <b>{setup.company}</b>
            {setup.connectedAt && ` by ${setup.connectedBy ?? "Admin"}, ${agoText(setup.connectedAt)}`} (key …{setup.keyHint}).
            {thisPcSends ? " This is the PC that sends." : " Another PC sends; connecting this one stops that one."}
          </p>
        ) : (
          <p className="font-medium">No Tally PC is connected yet. Open this page on the Tally PC to connect it.</p>
        )}

        {!version && (
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            <p>
              On the Tally PC: install the MV Company Tally extension in Chrome (download, unzip, then chrome://extensions → Developer mode →
              Load unpacked → the <code>mvc-tally</code> folder), then reload this page.
            </p>
            <Button variant="outline" size="sm" onClick={() => downloadTallyExtension().catch(() => toast.error("Could not download"))}>
              <Download className="mr-1 h-4 w-4" /> Download the Tally extension
            </Button>
          </div>
        )}
        {version && !extensionCanSync(version) && (
          <div className="space-y-2 rounded-md bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
            <p>
              The Tally extension on this PC is version {version}; sending debtors needs 1.1.0 or later. Download it, replace the files in the{" "}
              <code>mvc-tally</code> folder, then press the reload button on the extension in chrome://extensions and reload this page.
            </p>
            <Button variant="outline" size="sm" onClick={() => downloadTallyExtension().catch(() => toast.error("Could not download"))}>
              <Download className="mr-1 h-4 w-4" /> Download the new version
            </Button>
          </div>
        )}

        {extensionCanSync(version) && (
          <>
            {info?.last && (
              <p className={info.last.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
                Last update from this PC {agoText(info.last.at)}:{" "}
                {info.last.ok ? `${info.last.ledgers} ledgers, ${info.last.changed} changed` : info.last.message}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="debtors-company">Company in Tally</Label>
                <Input id="debtors-company" className="w-64" value={company} maxLength={100} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="debtors-port">Tally port</Label>
                <Input id="debtors-port" className="w-24" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} />
              </div>
              <Button onClick={connect} disabled={!!busy || !company.trim()}>
                {busy === "connect" || (busy === "sync" && !thisPcSends) ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}
                {thisPcSends ? "Connect again" : "Connect this PC"}
              </Button>
              {thisPcSends && (
                <Button variant="outline" onClick={sendNow} disabled={!!busy}>
                  {busy === "sync" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Send from Tally now
                </Button>
              )}
            </div>
          </>
        )}

        {setup?.connected && (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={disconnect} disabled={!!busy}>
            <Unplug className="mr-1 h-4 w-4" /> Disconnect the Tally PC
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

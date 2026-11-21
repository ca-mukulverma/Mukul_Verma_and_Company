"use client";

import { useCallback, useEffect, useState } from "react";
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
import { agoText, DEBTOR_ENTITIES, ENTITY_LABELS, type DebtorEntity } from "@/lib/tally-debtors-shared";

export interface SyncSetup {
  company: string;
  connected: boolean;
  keyHint: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
}

// Admin, on the PC where a firm's TallyPrime runs: connects that PC for MVC,
// for B Edge, or for both (each firm's company can be on its own PC). The
// PC's Tally extension then sends that firm's Sundry Debtors to the app
// (docs/TALLY_DEBTORS.md).
export function TallyPcPanel({ setups, onChanged }: { setups: Record<DebtorEntity, SyncSetup | null>; onChanged: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [info, setInfo] = useState<SyncInfo | null>(null);

  const reloadInfo = useCallback(() => {
    syncInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  // The bridge marks the page as soon as it loads; look again in a moment
  useEffect(() => {
    const look = () => {
      const v = tallyExtensionVersion();
      setVersion(v);
      if (extensionCanSync(v)) reloadInfo();
    };
    look();
    const t = setTimeout(look, 800);
    return () => clearTimeout(t);
  }, [reloadInfo]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Monitor className="h-5 w-5" /> Tally PCs (Admin)
        </CardTitle>
        <CardDescription>
          Each firm&apos;s Tally company sends its Sundry Debtors (only those) at 11:30 am, 1:00 pm, 4:00 pm and 7:00 pm, and on Refresh
          now, from the PC where it is kept, through the MV Company Tally extension in Chrome. MVC and B Edge can be on different PCs,
          or both on one: open this page on that PC and connect the firm(s) kept there. Other companies open in Tally are never read. If
          an update fails it is not tried again on its own: press Refresh now once Tally is ready. An update missed while the PC was off
          is sent when it is switched on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!version && (
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            <p>
              On a Tally PC: install the MV Company Tally extension in Chrome (download, unzip, then chrome://extensions → Developer mode →
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
              The Tally extension on this PC is version {version}; sending debtors and sales for MVC and B Edge needs 1.3.0 or later. Download it,
              replace the files in the <code>mvc-tally</code> folder, then press the reload button on the extension in chrome://extensions
              and reload this page.
            </p>
            <Button variant="outline" size="sm" onClick={() => downloadTallyExtension().catch(() => toast.error("Could not download"))}>
              <Download className="mr-1 h-4 w-4" /> Download the new version
            </Button>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {DEBTOR_ENTITIES.map((entity) => (
            <FirmConnection
              key={entity}
              entity={entity}
              setup={setups[entity]}
              canSync={extensionCanSync(version)}
              here={info?.firms?.[entity] ?? null}
              onChanged={() => {
                reloadInfo();
                onChanged();
              }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FirmConnection({
  entity,
  setup,
  canSync,
  here,
  onChanged,
}: {
  entity: DebtorEntity;
  setup: SyncSetup | null;
  canSync: boolean;
  here: NonNullable<SyncInfo["firms"]>[DebtorEntity] | null;
  onChanged: () => void;
}) {
  const label = ENTITY_LABELS[entity];
  const [company, setCompany] = useState(setup?.company ?? (entity === "MVC" ? TALLY_MVC_COMPANY : ""));
  const [port, setPort] = useState(String(here?.port ?? tallyPort()));
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);
  const thisPcSends = !!here;

  useEffect(() => {
    if (setup?.company) setCompany(setup.company);
  }, [setup?.company]);

  const fail = (error: unknown, fallback: string) =>
    toast.error(error instanceof Error && !axios.isAxiosError(error) ? error.message : apiError(error, fallback), { duration: 10_000 });

  const connect = async () => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return toast.error("The Tally port is a number such as 9000");
    if (setup?.company && setup.company.trim().toLowerCase() !== company.trim().toLowerCase()) {
      if (!confirm(`${label}'s debtors now come from "${setup.company}". Connecting "${company}" instead removes those from the app. Continue?`)) return;
    }
    setBusy("connect");
    try {
      saveTallyPort(p);
      const status = await tallyStatus();
      if (!status.ok) throw new Error(status.error);
      if (!status.companies?.some((c) => c.trim().toLowerCase() === company.trim().toLowerCase())) {
        throw new Error(`"${company}" is not open in TallyPrime on this PC. Open now: ${status.companies?.join(", ") || "none"}.`);
      }
      const { data } = await axios.post<{ key: string; company: string }>("/api/debtors/connect", { entity, company: company.trim() });
      const saved = await syncConnect(entity, data.key, data.company);
      if (!saved.ok) throw new Error(saved.error);
      toast.success(`This PC is connected for ${label}. Reading its debtors from Tally now…`);
      setBusy("sync");
      const result = await syncNow(entity);
      if (!result.ok) throw new Error(result.error);
      toast.success(`${label}: sent ${result.ledgers} debtor ledgers from Tally`);
    } catch (error) {
      fail(error, "Could not connect this PC");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const sendNow = async () => {
    setBusy("sync");
    try {
      const result = await syncNow(entity);
      if (!result.ok) throw new Error(result.error);
      toast.success(`${label}: sent from Tally, ${result.ledgers} ledgers, ${result.changed} changed`);
    } catch (error) {
      fail(error, "Could not read Tally");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const disconnect = async () => {
    if (!confirm(`Stop ${label}'s Tally PC sending debtors? ${label}'s debtors already in the app stay; Refresh now and the scheduled updates stop until it is connected again.`)) return;
    setBusy("disconnect");
    try {
      await axios.delete("/api/debtors/connect", { params: { entity } });
      if (thisPcSends) await syncDisconnect(entity);
      toast.success(`${label}'s Tally PC is disconnected`);
    } catch (error) {
      fail(error, "Could not disconnect");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-base font-semibold">{label}</p>
      {setup?.connected ? (
        <p>
          Connected for <b>{setup.company}</b>
          {setup.connectedAt && ` by ${setup.connectedBy ?? "Admin"}, ${agoText(setup.connectedAt)}`} (key …{setup.keyHint}).{" "}
          {thisPcSends ? "This PC sends it." : "Another PC sends it; connecting this one stops that one."}
        </p>
      ) : (
        <p className="font-medium">Not connected. Open this page on the PC where {label}&apos;s Tally company is kept.</p>
      )}
      {here?.last && (
        <p className={here.last.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
          Last update from this PC {agoText(here.last.at)}: {here.last.ok ? `${here.last.ledgers} ledgers, ${here.last.changed} changed` : here.last.message}
        </p>
      )}
      {canSync && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`company-${entity}`}>Company in Tally</Label>
            <Input
              id={`company-${entity}`}
              className="w-60"
              value={company}
              maxLength={100}
              placeholder={entity === "BEDGE" ? "B Edge's company name in Tally" : undefined}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`port-${entity}`}>Tally port</Label>
            <Input id={`port-${entity}`} className="w-24" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} />
          </div>
          <Button onClick={connect} disabled={!!busy || !company.trim()} aria-label={`Connect this PC for ${label}`}>
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
      )}
      {setup?.connected && (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={disconnect} disabled={!!busy}>
          <Unplug className="mr-1 h-4 w-4" /> Disconnect {label}&apos;s Tally PC
        </Button>
      )}
    </div>
  );
}

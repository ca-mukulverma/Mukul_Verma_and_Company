"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, FileText, Loader2, Mail, MapPin, MessageCircle, Phone, Send, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/components/compliance/types";
import { ChatMode, openChat, saveChatMode, savedChatMode } from "@/components/compliance/whatsapp-send";
import { whatsappNumber } from "@/lib/client-contacts";
import { cn } from "@/lib/utils";
import {
  amount,
  asOfText,
  balance,
  freshness,
  fyLabel,
  fyStartYear,
  istToday,
  ledgerFileName,
  longDate,
  statement,
  tallyDate,
} from "@/lib/tally-debtors-shared";
import type { LoadedLedger, PartyDetails, SyncStatus } from "@/lib/tally-debtors";
import { UpdateBanner, useSyncStatus } from "./sync-status";

// One debtor's ledger, as Tally shows it in Ledger Vouchers, with the party's
// details from the app, PDF / Excel and a WhatsApp link. Used on Debtors and
// in the client's Ledger tab. docs/TALLY_DEBTORS.md

interface LedgerResponse {
  ledger: LoadedLedger;
  party: PartyDetails | null;
  events: { kind: string; at: string; by: string; recipient: string | null; from: string; to: string }[];
}

type Action = "pdf" | "xlsx" | "whatsapp";

const EVENT_LABELS: Record<string, string> = { pdf: "PDF downloaded", excel: "Excel downloaded", whatsapp: "Sent on WhatsApp" };

export function LedgerView({ ledgerId, showParty = true }: { ledgerId: string; showParty?: boolean }) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [initialStatus, setInitialStatus] = useState<SyncStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const today = istToday();
  const fy = fyStartYear(today);
  const [preset, setPreset] = useState<"this" | "last" | "custom">("this");
  const [range, setRange] = useState({ from: `${fy}-04-01`, to: today });
  const [narration, setNarration] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [sharing, setSharing] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const sync = useSyncStatus(initialStatus, reload);

  useEffect(() => {
    let cancelled = false;
    Promise.all([axios.get<LedgerResponse>(`/api/debtors/${ledgerId}`), axios.get<SyncStatus>("/api/debtors/status")])
      .then(([ledger, status]) => {
        if (cancelled) return;
        setData(ledger.data);
        setInitialStatus(status.data);
        setFailed(null);
      })
      .catch((error) => !cancelled && setFailed(apiError(error, "Could not load the ledger")));
    return () => {
      cancelled = true;
    };
  }, [ledgerId, reloadKey]);

  const choosePreset = (value: "this" | "last" | "custom") => {
    setPreset(value);
    if (value === "this") setRange({ from: `${fy}-04-01`, to: today });
    if (value === "last") setRange({ from: `${fy - 1}-04-01`, to: `${fy}-03-31` });
  };

  const ledger = data?.ledger;
  const from = ledger && range.from < ledger.periodFrom ? ledger.periodFrom : range.from;
  const to = range.to < from ? from : range.to;
  const st = useMemo(() => (ledger ? statement(ledger, from, to) : null), [ledger, from, to]);
  const fresh = freshness(sync.status?.readAt ?? ledger?.readAt, sync.now);
  // The data on screen is older than the latest that came (after a refresh)
  const outdatedOnScreen = !!(sync.status?.readAt && ledger?.readAt && sync.status.readAt !== ledger.readAt);

  if (failed) return <p className="text-destructive">{failed}</p>;
  if (!data || !ledger || !st) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Before a download or a send: warn if an update was missed
  const start = (action: Action) => {
    if (fresh.level !== "fresh" || outdatedOnScreen) return setConfirming(action);
    run(action);
  };

  const run = async (action: Action) => {
    setConfirming(null);
    if (action === "whatsapp") return setSharing(true);
    setBusy(action);
    try {
      const response = await axios.get(`/api/debtors/${ledgerId}/file`, {
        params: { format: action, from, to, ...(narration && { narration: 1 }) },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ledgerFileName(ledger.name, from, to)}.${action}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      let message = "Could not make the file";
      const blob = (error as { response?: { data?: Blob } }).response?.data;
      if (blob instanceof Blob) {
        try {
          message = JSON.parse(await blob.text()).error || message;
        } catch {}
      }
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const party = data.party;

  return (
    <div className="space-y-4">
      <UpdateBanner sync={sync} />
      {outdatedOnScreen && (
        <p className="flex items-center gap-2 rounded-md bg-amber-100 p-2 text-sm font-medium text-amber-950 dark:bg-amber-950/50 dark:text-amber-50">
          <AlertTriangle className="h-4 w-4" /> Newer Tally data has come.
          <Button size="sm" variant="outline" onClick={reload}>
            Show it
          </Button>
        </p>
      )}

      {showParty && <PartyCard party={party} ledgerName={ledger.name} group={ledger.group} />}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Period</Label>
              <Select value={preset} onValueChange={(v) => choosePreset(v as "this" | "last" | "custom")}>
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="this">This year ({fyLabel(fy)}) to date</SelectItem>
                  <SelectItem value="last">Last year ({fyLabel(fy - 1)})</SelectItem>
                  <SelectItem value="custom">Choose dates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === "custom" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="ledger-from">From</Label>
                  <Input
                    id="ledger-from"
                    type="date"
                    className="w-40"
                    min={ledger.periodFrom}
                    max={ledger.periodTo}
                    value={range.from}
                    onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ledger-to">To</Label>
                  <Input
                    id="ledger-to"
                    type="date"
                    className="w-40"
                    min={range.from}
                    max={ledger.periodTo}
                    value={range.to}
                    onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
                  />
                </div>
              </>
            )}
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox checked={narration} onCheckedChange={(v) => setNarration(v === true)} />
              Show narration
            </label>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => start("pdf")} disabled={!!busy}>
                {busy === "pdf" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                PDF
              </Button>
              <Button variant="outline" onClick={() => start("xlsx")} disabled={!!busy}>
                {busy === "xlsx" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1 h-4 w-4" />}
                Excel
              </Button>
              <Button onClick={() => start("whatsapp")} disabled={!!busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <MessageCircle className="mr-1 h-4 w-4" /> WhatsApp
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TallyLedgerTable company={ledger.company} name={ledger.name} st={st} narration={narration} />
        </CardContent>
      </Card>

      {data.events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Downloaded and sent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.events.map((e, i) => (
              <p key={i} className="text-muted-foreground">
                {EVENT_LABELS[e.kind] ?? e.kind}
                {e.recipient ? ` to +${e.recipient}` : ""} by {e.by}, {asOfText(e.at)} ({longDate(e.from)} to {longDate(e.to)})
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" /> Check the Tally data first
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="text-base font-semibold text-foreground">
                  This ledger is as of {ledger.readAt ? asOfText(ledger.readAt) : "an unknown time"}.
                </p>
                {outdatedOnScreen ? (
                  <p>Newer Tally data has come since this page opened. Show it before sending.</p>
                ) : fresh.level === "stale" ? (
                  <p>
                    The update due at {asOfText(fresh.missedSince)} did not come, so entries made in Tally since then (for example a payment
                    received) are not in it.
                  </p>
                ) : (
                  <p>No update from Tally has come.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => confirming && run(confirming)}>
              Use it anyway
            </Button>
            {outdatedOnScreen ? (
              <Button
                onClick={() => {
                  setConfirming(null);
                  reload();
                }}
              >
                Show the newer data
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setConfirming(null);
                  sync.refresh();
                }}
                disabled={sync.waiting || !sync.status?.connected}
              >
                Refresh now
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sharing && (
        <WhatsAppDialog ledgerId={ledgerId} ledger={ledger} party={party} from={from} to={to} closing={st.closing} narration={narration} onClose={() => setSharing(false)} onSent={reload} />
      )}
    </div>
  );
}

// ─── The ledger as Tally shows it ───────────────────────────────────────────

export function TallyLedgerTable({ company, name, st, narration }: { company: string; name: string; st: ReturnType<typeof statement>; narration: boolean }) {
  const num = "whitespace-nowrap px-2 py-1 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-center">
        <p className="text-base font-bold">{company}</p>
        <p className="font-semibold">{name}</p>
        <p className="text-sm">Ledger Account</p>
        <p className="text-sm">
          {longDate(st.from)} to {longDate(st.to)}
        </p>
      </div>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-y font-semibold">
            <th className="px-2 py-1 text-left">Date</th>
            <th className="px-2 py-1 text-left">Particulars</th>
            <th className="px-2 py-1 text-left">Vch Type</th>
            <th className="px-2 py-1 text-left">Vch No.</th>
            <th className="px-2 py-1 text-right">Debit</th>
            <th className="px-2 py-1 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {st.lines.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                No entries in this period
              </td>
            </tr>
          )}
          {st.lines.map((e, i) => (
            <tr key={i} className="align-top hover:bg-muted/40">
              <td className="whitespace-nowrap px-2 py-1">{tallyDate(e.d)}</td>
              <td className="px-2 py-1">
                <span className="mr-2 text-muted-foreground">{e.dr > 0 ? "To" : "By"}</span>
                {e.p}
                {narration && e.r && <div className="text-xs italic text-muted-foreground">{e.r}</div>}
              </td>
              <td className="whitespace-nowrap px-2 py-1">{e.t}</td>
              <td className="whitespace-nowrap px-2 py-1">{e.n}</td>
              <td className={num}>{amount(e.dr)}</td>
              <td className={num}>{amount(e.cr)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t">
            <td colSpan={4} className="px-2 py-1 text-right">
              Opening Balance :
            </td>
            <td className={num}>{st.opening > 0 ? amount(st.opening) : ""}</td>
            <td className={num}>{st.opening < 0 ? amount(st.opening) : ""}</td>
          </tr>
          <tr>
            <td colSpan={4} className="px-2 py-1 text-right">
              Current Total :
            </td>
            <td className={num}>{amount(st.totalDr)}</td>
            <td className={num}>{amount(st.totalCr)}</td>
          </tr>
          <tr className="border-y font-bold">
            <td colSpan={4} className="px-2 py-1 text-right">
              Closing Balance :
            </td>
            <td className={num}>{st.closing > 0 ? amount(st.closing) : ""}</td>
            <td className={num}>{st.closing < 0 ? amount(st.closing) : st.closing === 0 ? "Nil" : ""}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── The party, from the app ────────────────────────────────────────────────

function PartyCard({ party, ledgerName, group }: { party: PartyDetails | null; ledgerName: string; group: string }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6 text-sm">
        <div className="space-y-1">
          <p className="text-xl font-bold">{ledgerName}</p>
          <p className="text-muted-foreground">Group in Tally: {group}</p>
        </div>
        {party ? (
          <div className="min-w-64 space-y-1">
            <p className="flex items-center gap-2 font-semibold">
              <User className="h-4 w-4" />
              {party.kind === "client" ? (
                <Link href={`/dashboard/clients/${party.id}`} className="underline-offset-2 hover:underline">
                  {party.companyName ? `${party.companyName} (${party.name})` : party.name}
                </Link>
              ) : (
                <>
                  {party.name} <Badge variant="secondary">Connector</Badge>
                </>
              )}
            </p>
            {party.kind === "connector" && <p className="text-muted-foreground">Bills of {party.clientCount} client(s) go to this ledger.</p>}
            {party.phones.map((p, i) => (
              <p key={i} className="flex items-center gap-2">
                <Phone className="h-4 w-4" /> {p.number} <span className="text-muted-foreground">({p.label}{p.whatsapp ? ", WhatsApp" : ""})</span>
              </p>
            ))}
            {party.email && (
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4" /> {party.email}
              </p>
            )}
            {party.address && (
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {party.address}
              </p>
            )}
            {(party.gstin || party.pan) && (
              <p className="text-muted-foreground">
                {party.gstin && `GSTIN ${party.gstin}`}
                {party.gstin && party.pan && " · "}
                {party.pan && `PAN ${party.pan}`}
              </p>
            )}
            {party.manager && <p className="text-muted-foreground">Managed by {party.manager}</p>}
          </div>
        ) : (
          <p className="max-w-sm text-muted-foreground">
            No client in the app is linked to this Tally ledger. Link it from the client&apos;s Tally ledger (Billing → Tally) to see the
            party&apos;s details here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sending on WhatsApp ────────────────────────────────────────────────────

const OTHER = "other";

function WhatsAppDialog({
  ledgerId,
  ledger,
  party,
  from,
  to,
  closing,
  narration,
  onClose,
  onSent,
}: {
  ledgerId: string;
  ledger: LoadedLedger;
  party: PartyDetails | null;
  from: string;
  to: string;
  closing: number;
  narration: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const numbers = (party?.phones ?? []).flatMap((p) => {
    const n = whatsappNumber(p.number);
    return n ? [{ number: n, label: `${p.label}: ${p.number}${p.whatsapp ? "" : " (not marked WhatsApp)"}`, whatsapp: p.whatsapp }] : [];
  });
  const first = numbers.find((n) => n.whatsapp) ?? numbers[0];
  const [choice, setChoice] = useState(first?.number ?? OTHER);
  const [other, setOther] = useState("");
  const [mode, setMode] = useState<ChatMode>(() => savedChatMode());
  const greeting = party ? (party.kind === "client" ? party.companyName || party.name : party.name) : ledger.name;
  const [text, setText] = useState(
    `Dear ${greeting},\n\nPlease find your ledger account with ${ledger.company} for ${longDate(from)} to ${longDate(to)}.\n` +
      `Closing balance: Rs. ${balance(closing)}` +
      (ledger.readAt ? ` (as per our books as on ${asOfText(ledger.readAt)})` : "") +
      `.\n\n{link}\n\nThe link works for 7 days. Kindly arrange the payment of the balance due.`
  );
  const [sending, setSending] = useState(false);
  const phone = choice === OTHER ? whatsappNumber(other) : choice;

  const send = async () => {
    if (!phone) return toast.error("Enter a mobile number with 10 digits (or with the country code)");
    if (!text.includes("{link}")) return toast.error("Keep {link} in the message: the ledger's link goes there");
    saveChatMode(mode);
    // Open the chat window now, while the click still counts, so it isn't blocked
    const width = Math.round(window.screen.availWidth / 2);
    if (mode === "web") window.open("about:blank", "whatsapp-web", `popup,width=${width},height=${window.screen.availHeight},left=${width},top=0`);
    if (mode === "phone") window.open("about:blank", "whatsapp");
    setSending(true);
    try {
      const { data } = await axios.post<{ url: string }>(`/api/debtors/${ledgerId}/share`, { from, to, narration, recipient: phone });
      openChat(mode, phone, text.replace("{link}", data.url));
      toast.success("The ledger link is in the WhatsApp message: press Send there");
      onSent();
      onClose();
    } catch (error) {
      toast.error(apiError(error, "Could not make the ledger link"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-600" /> Send the ledger on WhatsApp
          </DialogTitle>
          <DialogDescription>
            {ledger.name}, {longDate(from)} to {longDate(to)}. The PDF goes as a link that works for 7 days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>To</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.number} value={n.number}>
                    {n.label}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Another number…</SelectItem>
              </SelectContent>
            </Select>
            {choice === OTHER && <Input placeholder="Mobile number, e.g. 98260 12345" value={other} onChange={(e) => setOther(e.target.value)} inputMode="tel" autoFocus />}
          </div>
          <div className="space-y-1">
            <Label>Message</Label>
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Open in</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as ChatMode)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="web">WhatsApp Web</SelectItem>
                <SelectItem value="desktop">WhatsApp app on this computer</SelectItem>
                <SelectItem value="phone">WhatsApp on this phone</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || !phone} className={cn("bg-emerald-600 text-white hover:bg-emerald-700")}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Send on WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

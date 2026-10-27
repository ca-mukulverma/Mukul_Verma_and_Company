"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, KeyRound, Loader2, Send, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { REQUEST_CATEGORIES, RequestTypeView } from "@/lib/client-requests";
import { clientDocType } from "@/lib/client-documents";

// Send to Client: pick what the client asked for, check what it picked, send.
// See docs/CLIENT_REQUESTS.md.

interface DispatchFile {
  id: string;
  source: "document" | "bill";
  label: string;
  fileName: string;
  group: string;
  size: number;
  selected: boolean;
}

interface Preview {
  client: { id: string; name: string; emails: string[] };
  company: "MVC" | "BEDGE";
  range: { from: string; to: string } | null;
  years: number;
  files: DispatchFile[];
  details: { field: string; label: string; value: string | null; selected: boolean }[];
  logins: { id: string; title: string; username: string; portal: string | null; selected: boolean }[] | null;
  statement: boolean;
  canSeeBills: boolean;
  missing: string[];
}

interface PreviewResponse {
  preview: Preview;
  mailboxes: { company: "MVC" | "BEDGE"; from: string; configured: boolean }[];
  sentToday: number;
  dailyLimit: number;
  storageReady: boolean;
}

interface HistoryEntry {
  id: string;
  requestName: string;
  sentTo: string;
  thirdParty: boolean;
  includedLogins: boolean;
  files: { name: string; label: string }[];
  sentBy: string | null;
  createdAt: string;
}

const CUSTOM = "custom";
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

const errorOf = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function toggle(set: Set<string>, id: string, on: boolean) {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export function SendToClient({ clientId }: { clientId: string }) {
  const [requests, setRequests] = useState<RequestTypeView[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [requestId, setRequestId] = useState<string>("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [years, setYears] = useState(1);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const [docIds, setDocIds] = useState<Set<string>>(new Set());
  const [billIds, setBillIds] = useState<Set<string>>(new Set());
  const [loginIds, setLoginIds] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Set<string>>(new Set());
  const [statement, setStatement] = useState(false);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [company, setCompany] = useState<"MVC" | "BEDGE">("MVC");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  const request = requests?.find((r) => r.id === requestId) ?? null;

  useEffect(() => {
    axios
      .get("/api/client-requests")
      .then(({ data }) => {
        setRequests(data.requests);
        setIsAdmin(data.isAdmin);
      })
      .catch((e) => {
        toast.error(errorOf(e, "Failed to load the requests"));
        setRequests([]);
      });
  }, []);

  const loadHistory = useCallback(() => {
    axios
      .get(`/api/clients/${clientId}/send`, { params: { history: 1 } })
      .then(({ data }) => setHistory(data.history))
      .catch(() => setHistory([]));
  }, [clientId]);
  useEffect(loadHistory, [loadHistory]);

  // Picks again when the request, the period or the years change
  const loadPreview = useCallback(
    async (id: string, options: { range?: { from: string; to: string } | null; years?: number } = {}) => {
      setLoading(true);
      try {
        const { data } = await axios.get<PreviewResponse>(`/api/clients/${clientId}/send`, {
          params: { requestId: id, ...(options.range && { from: options.range.from, to: options.range.to }), ...(options.years && { years: options.years }) },
        });
        const p = data.preview;
        setData(data);
        setRange(p.range);
        setYears(p.years);
        setDocIds(new Set(p.files.filter((f) => f.source === "document" && f.selected).map((f) => f.id)));
        setBillIds(new Set(p.files.filter((f) => f.source === "bill" && f.selected).map((f) => f.id)));
        setLoginIds(new Set((p.logins ?? []).filter((l) => l.selected).map((l) => l.id)));
        setDetails(new Set(p.details.filter((d) => d.selected).map((d) => d.field)));
        setStatement(p.statement);
        setCompany(p.company);
        setTo((current) => current ?? p.client.emails.join(", "));
        setShowAll(id === CUSTOM);
      } catch (e) {
        toast.error(errorOf(e, "Failed to pick the files"));
      } finally {
        setLoading(false);
      }
    },
    [clientId]
  );

  const chooseRequest = (id: string) => {
    setRequestId(id);
    loadPreview(id);
  };

  const preview = data?.preview ?? null;
  const usesRange = !!request && (request.config.range !== "none" || request.config.statement || request.config.bills === "range");
  const usesYears = !!request && (request.config.documents.some((d) => clientDocType(d)?.yearly) || request.config.returnWorks.includes("Income Tax Return"));

  const files = useMemo(() => preview?.files ?? [], [preview]);
  const isChosen = useCallback((f: DispatchFile) => (f.source === "bill" ? billIds : docIds).has(f.id), [billIds, docIds]);
  const shownFiles = showAll ? files : files.filter((f) => f.selected || isChosen(f));
  const groups = useMemo(() => {
    const map = new Map<string, DispatchFile[]>();
    for (const f of shownFiles) map.set(f.group, [...(map.get(f.group) ?? []), f]);
    return [...map.entries()];
  }, [shownFiles]);

  const chosenDocs = files.filter((f) => f.source === "document" && docIds.has(f.id));
  const totalSize = chosenDocs.reduce((s, f) => s + f.size, 0);
  const asLinks = totalSize > MAX_ATTACHMENT_BYTES;
  const count = chosenDocs.length + billIds.size;
  const nothing = count === 0 && loginIds.size === 0 && details.size === 0 && !statement;

  const recipients = (to ?? "").split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const thirdParty = !!preview && recipients.some((a) => !preview.client.emails.includes(a));
  const mailbox = data?.mailboxes.find((m) => m.company === company);
  const atLimit = !!data && data.sentToday >= data.dailyLimit;

  const send = async () => {
    if (!preview) return;
    if (loginIds.size > 0 && !window.confirm("This email includes portal passwords. Send it?")) return;
    setSending(true);
    try {
      const { data: result } = await axios.post(`/api/clients/${clientId}/send`, {
        requestId: request?.id ?? null,
        company,
        to: to ?? "",
        note: note.trim() || null,
        documentIds: [...docIds],
        billIds: [...billIds],
        credentialIds: [...loginIds],
        details: [...details],
        statement: statement && range ? range : null,
      });
      toast.success(`Sent to ${result.sentTo}`);
      setNote("");
      loadHistory();
    } catch (e) {
      toast.error(errorOf(e, "The email could not be sent"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href={`/dashboard/clients/${clientId}`} aria-label="Back to the client">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Send to client</h1>
            <p className="text-sm text-muted-foreground">{preview?.client.name ?? "Pick what the client asked for, check it and send"}</p>
          </div>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/clients/requests">
              <Settings2 className="mr-2 h-4 w-4" /> Edit requests
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What did the client ask for?</CardTitle>
          <CardDescription>The files and details are picked for you. Untick anything not wanted, or add more.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requests === null ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select value={requestId} onValueChange={chooseRequest}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a request" /></SelectTrigger>
              <SelectContent className="max-h-96">
                {REQUEST_CATEGORIES.map((category) => {
                  const list = requests.filter((r) => r.category === category);
                  if (list.length === 0) return null;
                  return (
                    <SelectGroup key={category}>
                      <SelectLabel>{category}</SelectLabel>
                      {list.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}{r.adminOnly ? " (Admin)" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
                <SelectGroup>
                  <SelectLabel>Other</SelectLabel>
                  <SelectItem value={CUSTOM}>Pick files myself</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {request?.description && <p className="text-sm text-muted-foreground">{request.description}</p>}

          {(usesRange || requestId === CUSTOM) && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Period from</Label>
                <Input
                  type="month"
                  className="w-40"
                  value={range?.from ?? ""}
                  onChange={(e) => {
                    const next = { from: e.target.value, to: range?.to ?? e.target.value };
                    setRange(next);
                    if (next.from && next.to) loadPreview(requestId, { range: next, years });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">to</Label>
                <Input
                  type="month"
                  className="w-40"
                  value={range?.to ?? ""}
                  onChange={(e) => {
                    const next = { from: range?.from ?? e.target.value, to: e.target.value };
                    setRange(next);
                    if (next.from && next.to) loadPreview(requestId, { range: next, years });
                  }}
                />
              </div>
            </div>
          )}
          {usesYears && (
            <div className="space-y-1">
              <Label className="text-xs">Financial years (latest)</Label>
              <Select value={String(years)} onValueChange={(v) => loadPreview(requestId, { range, years: Number(v) })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <SelectItem key={n} value={String(n)}>{n === 1 ? "Latest year" : `Last ${n} years`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && !preview && <Skeleton className="h-48 w-full" />}

      {preview && (
        <>
          <Card className={loading ? "opacity-60" : undefined}>
            <CardHeader>
              <CardTitle>What will be sent</CardTitle>
              <CardDescription>
                {count} file{count === 1 ? "" : "s"}
                {chosenDocs.length > 0 && ` · ${formatSize(totalSize)}`}
                {details.size > 0 && ` · ${details.size} detail${details.size === 1 ? "" : "s"}`}
                {loginIds.size > 0 && ` · ${loginIds.size} login${loginIds.size === 1 ? "" : "s"}`}
                {statement && " · statement of bills"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {preview.missing.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <p className="mb-1 flex items-center gap-1 font-medium"><AlertTriangle className="h-4 w-4" /> Not found</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {preview.missing.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                  <p className="mt-2 text-xs">
                    Send the rest, or add the missing files first under the client&apos;s <Link className="underline" href={`/dashboard/clients/${clientId}`}>Documents</Link> tab or on the compliance sheet.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">Files</h3>
                  {files.length > 0 && (
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "Show only picked files" : `Show all ${files.length} files of the client`}
                    </Button>
                  )}
                </div>
                {groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{files.length ? "No files picked." : "The client has no files yet."}</p>
                ) : (
                  groups.map(([group, list]) => (
                    <div key={group} className="space-y-1">
                      <p className="text-xs font-medium uppercase text-muted-foreground">{group}</p>
                      <ul className="divide-y rounded-md border">
                        {list.map((f) => (
                          <li key={f.id}>
                            <label className="flex cursor-pointer items-start gap-2 p-2 text-sm">
                              <Checkbox
                                className="mt-0.5"
                                checked={isChosen(f)}
                                onCheckedChange={(c) =>
                                  f.source === "bill" ? setBillIds((s) => toggle(s, f.id, c === true)) : setDocIds((s) => toggle(s, f.id, c === true))
                                }
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block">{f.label}</span>
                                <span className="block truncate text-xs text-muted-foreground">{f.fileName}{f.source === "document" ? ` · ${formatSize(f.size)}` : ""}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <h3 className="font-medium">Details in the email</h3>
                <div className="grid gap-1 sm:grid-cols-2">
                  {preview.details.filter((d) => d.value).map((d) => (
                    <label key={d.field} className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox className="mt-0.5" checked={details.has(d.field)} onCheckedChange={(c) => setDetails((s) => toggle(s, d.field, c === true))} />
                      <span className="min-w-0"><span className="text-muted-foreground">{d.label}:</span> <span className="break-words">{d.value}</span></span>
                    </label>
                  ))}
                </div>
              </div>

              {preview.logins && preview.logins.length > 0 && (
                <div className="space-y-2 rounded-md border border-red-200 p-3 dark:border-red-900">
                  <h3 className="flex items-center gap-1 font-medium"><KeyRound className="h-4 w-4" /> Portal logins (Admin only)</h3>
                  <p className="text-xs text-muted-foreground">Passwords go in the email itself, and only to the client&apos;s own email address.</p>
                  {preview.logins.map((l) => (
                    <label key={l.id} className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox className="mt-0.5" checked={loginIds.has(l.id)} onCheckedChange={(c) => setLoginIds((s) => toggle(s, l.id, c === true))} />
                      <span>
                        {l.title} <span className="text-muted-foreground">({l.username || "no user ID"})</span>
                        {l.portal && <Badge variant="outline" className="ml-2">{l.portal}</Badge>}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {preview.canSeeBills && (
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={statement} onCheckedChange={(c) => setStatement(c === true)} disabled={!range} />
                  <span>
                    Statement of bills in the email{range ? ` (${range.from} to ${range.to})` : " (choose a period above)"}
                  </span>
                </label>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="send-to">To</Label>
                <Input id="send-to" value={to ?? ""} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com, bank@example.com" />
                <p className="text-xs text-muted-foreground">Up to 5 addresses, separated by commas. Any address can be used.</p>
                {thirdParty && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Not on the client&apos;s record: {recipients.filter((a) => !preview.client.emails.includes(a)).join(", ")}. The send is recorded as going to a third party.
                    {loginIds.size > 0 && " Portal logins can't go to these addresses."}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="send-note">Message (optional)</Label>
                <Textarea id="send-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Added to the email after the list of files" />
              </div>
              <div className="space-y-1">
                <Label>From</Label>
                <Select value={company} onValueChange={(v) => setCompany(v as "MVC" | "BEDGE")}>
                  <SelectTrigger className="w-full sm:w-96"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data?.mailboxes.map((m) => (
                      <SelectItem key={m.company} value={m.company}>{m.from}{m.configured ? "" : " (not set up)"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {asLinks && <p className="text-xs text-muted-foreground">The files are over 18 MB together, so the email will carry download links (valid for 7 days) instead of attachments.</p>}
              {!data?.storageReady && chosenDocs.length > 0 && (
                <p className="text-xs text-red-600">Document storage (Cloudflare R2) is not set up, so files can&apos;t be sent.</p>
              )}
              {mailbox?.configured === false && (
                <p className="text-xs text-red-600">This mailbox&apos;s Gmail app password is not set up yet (see docs/BILLING.md), so it can&apos;t send.</p>
              )}
              {atLimit && <p className="text-xs text-red-600">About {data?.dailyLimit} emails have gone out today, Gmail&apos;s daily limit. Send this tomorrow.</p>}
              <Button onClick={send} disabled={sending || loading || nothing || !to?.trim() || atLimit || mailbox?.configured === false}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recently sent</CardTitle>
        </CardHeader>
        <CardContent>
          {history === null ? (
            <Skeleton className="h-16 w-full" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent from here yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {history.map((h) => (
                <li key={h.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{h.requestName}</span>
                    {h.thirdParty && <Badge variant="outline">Third party</Badge>}
                    {h.includedLogins && <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-300">Logins</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(h.createdAt), "d MMM yyyy, h:mm a")} · to {h.sentTo}
                    {h.sentBy ? ` · by ${h.sentBy}` : ""} · {h.files.length} file{h.files.length === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

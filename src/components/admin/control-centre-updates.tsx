"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Download, ExternalLink, Loader2, Rocket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/components/billing/bill-types";

// Admin → Control Centre → Updates and Support files (docs/CONTROL_CENTRE.md).

interface Published {
  id: number;
  version: string;
  notes: string | null;
  mandatory: boolean;
  sha256: string;
  assetName: string;
  size: number;
  clientCodes: string[];
  withdrawn: boolean;
  publishedBy: string;
  publishedAt: string;
}
interface GithubRelease {
  version: string;
  title: string;
  publishedAt: string | null;
  prerelease: boolean;
  link: string;
  installer: { name: string; size: number } | null;
}
interface DeskVersion {
  code: string;
  name: string;
  appVersion: string | null;
  lastReportAt: string | null;
}
interface SupportFile {
  id: string;
  fileName: string;
  size: number;
  note: string | null;
  appVersion: string | null;
  receivedAt: string;
  deskClient: { code: string; name: string };
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "–";
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ------------------------------------------------------------------ Updates
export function UpdatesTab() {
  const [data, setData] = useState<{
    published: Published[];
    github: GithubRelease[];
    githubError: string | null;
    desks: DeskVersion[];
    codes: string[];
  } | null>(null);
  const [form, setForm] = useState({ version: "", notes: "", mandatory: false, clients: [] as string[] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    axios
      .get("/api/admin/desk/updates")
      .then((r) => setData(r.data))
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load")));
  }, []);
  useEffect(load, [load]);

  const publish = async () => {
    const to = form.clients.length ? form.clients.join(", ") : "ALL clients";
    if (!window.confirm(`Publish Gudakesa Desk ${form.version} to ${to}? They see "Update – Install" at their next contact.`)) return;
    setBusy(true);
    try {
      await axios.post("/api/admin/desk/updates", {
        version: form.version, notes: form.notes, mandatory: form.mandatory, clientCodes: form.clients,
      });
      toast.success("Published. Clients see it at their next contact (11:30, 1, 4 or 7 PM on weekdays).");
      setForm({ version: "", notes: "", mandatory: false, clients: [] });
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (p: Published) => {
    if (!window.confirm(`${p.withdrawn ? "Bring back" : "Withdraw"} version ${p.version}?`)) return;
    await axios.patch("/api/admin/desk/updates", { id: p.id, withdrawn: !p.withdrawn }).catch((e) => toast.error(apiErrorMessage(e)));
    load();
  };

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const ready = data.github.filter((g) => g.installer);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" /> Publish a new version
          </CardTitle>
          <CardDescription>
            Pick a version GitHub has built. Its check-sum is filled in automatically. Clients&apos; PCs show
            &quot;Update – Install&quot; at their next contact; nothing installs until someone there clicks it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
          {data.githubError && (
            <p className="flex items-center gap-2 text-amber-600 sm:col-span-3">
              <AlertTriangle className="h-4 w-4" /> {data.githubError}
            </p>
          )}
          <div className="space-y-1">
            <Label>Version</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2"
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
            >
              <option value="">Choose…</option>
              {ready.map((g) => (
                <option key={g.version} value={g.version}>
                  {g.version} – built {when(g.publishedAt)}
                  {g.prerelease ? " (test build)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Send to</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {data.codes.length === 0 && <span className="text-muted-foreground">All clients</span>}
              {data.codes.map((c) => (
                <label key={c} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.clients.includes(c)}
                    onChange={(e) =>
                      setForm({ ...form, clients: e.target.checked ? [...form.clients, c] : form.clients.filter((x) => x !== c) })
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">None ticked = all clients</p>
          </div>
          <div className="space-y-1">
            <Label>Must install?</Label>
            <label className="flex items-center gap-2 pt-1">
              <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} />
              Mark as important
            </label>
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label>What is new (shown to staff in a pop-up on the client&apos;s PC: one point per line)</Label>
            <Textarea
              rows={6}
              placeholder={"• Bank: entries already in Tally are never posted again\n• GSTR-2B comes straight from the MV Company app"}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="sm:col-span-3">
            <Button onClick={publish} disabled={busy || !form.version}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Rocket className="mr-1 h-4 w-4" />} Publish
            </Button>
            {busy && <span className="ml-2 text-xs text-muted-foreground">Checking the installer – can take a minute…</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Published to clients</CardTitle>
          <CardDescription>The highest version a client may see is the one it gets. Withdraw a mistake here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.published.length === 0 ? (
            <p className="text-muted-foreground">Nothing published yet.</p>
          ) : (
            data.published.map((p) => (
              <div key={p.id} className={`flex flex-wrap items-center gap-2 rounded border p-2 ${p.withdrawn ? "opacity-50" : ""}`}>
                <Badge variant="outline">{p.version}</Badge>
                {p.mandatory && <Badge>Important</Badge>}
                <span className="text-muted-foreground">
                  → {p.clientCodes.length ? p.clientCodes.join(", ") : "all"} • {p.publishedBy}, {when(p.publishedAt)} • {mb(p.size)}
                </span>
                {p.withdrawn && <Badge variant="secondary">Withdrawn</Badge>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => withdraw(p)}>
                  {p.withdrawn ? "Bring back" : "Withdraw"}
                </Button>
                {p.notes && <div className="w-full text-xs">{p.notes}</div>}
                <div className="w-full break-all font-mono text-[10px] text-muted-foreground">SHA-256 {p.sha256}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version on each client&apos;s PC</CardTitle>
            <CardDescription>From the latest daily report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.desks.map((d) => (
              <div key={d.code} className="flex justify-between gap-2">
                <span>{d.name}</span>
                <span className="text-muted-foreground">
                  {d.appVersion ?? "–"} ({when(d.lastReportAt)})
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Built on GitHub</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.github.length === 0 ? (
              <p className="text-muted-foreground">No releases found.</p>
            ) : (
              data.github.map((g) => (
                <div key={g.version} className="flex flex-wrap items-center gap-2">
                  <a href={g.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline">
                    {g.title} <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="text-muted-foreground">{when(g.publishedAt)}</span>
                  {!g.installer && <Badge variant="secondary">no installer yet</Badge>}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Support files
export function SupportTab() {
  const [files, setFiles] = useState<SupportFile[] | null>(null);

  const load = useCallback(() => {
    axios
      .get<{ files: SupportFile[] }>("/api/admin/desk/support")
      .then((r) => setFiles(r.data.files))
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load")));
  }, []);
  useEffect(load, [load]);

  const remove = async (f: SupportFile) => {
    if (!window.confirm(`Delete ${f.fileName} from ${f.deskClient.name} for good? It cannot be brought back.`)) return;
    await axios
      .delete("/api/admin/desk/support", { params: { id: f.id } })
      .then(() => toast.success("Deleted"))
      .catch((e) => toast.error(apiErrorMessage(e)));
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Support files from clients&apos; PCs</CardTitle>
        <CardDescription>
          Sent from Gudakesa Desk → Settings → Send support file to MVC: logs and version, no passwords or keys. Save
          them in a folder outside the code (e.g. Documents\ClientData\Gudakesa) and delete them here when done.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {files === null ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : files.length === 0 ? (
          <p className="text-muted-foreground">No support files.</p>
        ) : (
          files.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
              <b>{f.deskClient.name}</b>
              <span>{f.fileName}</span>
              <span className="text-muted-foreground">
                {mb(f.size)} • {when(f.receivedAt)}
                {f.appVersion ? ` • version ${f.appVersion}` : ""}
              </span>
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/admin/desk/support?id=${f.id}`}>
                    <Download className="mr-1 h-4 w-4" /> Download
                  </a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(f)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {f.note && <div className="w-full text-xs text-muted-foreground">Note: {f.note}</div>}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

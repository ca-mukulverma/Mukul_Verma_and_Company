"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  DETAIL_FIELDS,
  DetailField,
  PORTALS,
  Portal,
  RANGE_OPTIONS,
  REQUEST_CATEGORIES,
  RETURN_DOC_KINDS,
  RETURN_WORKS,
  RangeOption,
  RequestConfig,
  RequestTypeView,
} from "@/lib/client-requests";
import { CLIENT_DOC_GROUPS, CLIENT_DOC_TYPES } from "@/lib/client-documents";

// Clients → Send to Client requests (Admin): switch requests on or off, edit
// what they pick, add new ones.

const RETURN_DOC_LABELS: Record<(typeof RETURN_DOC_KINDS)[number], string> = {
  RETURN_PDF: "Return PDF",
  RETURN_JSON: "Return JSON",
  GSTR1A_PDF: "GSTR-1A PDF",
  GSTR1A_JSON: "GSTR-1A JSON",
  CHALLAN: "Challan",
  CERTIFICATE: "Form 16/16A",
  OTHER: "Other files",
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  category: (typeof REQUEST_CATEGORIES)[number];
  sortOrder: number;
  config: RequestConfig;
  otherWorks: string;
};

const EMPTY_CONFIG: RequestConfig = {
  range: "none",
  years: 1,
  returnWorks: [],
  returnDocs: [],
  documents: [],
  details: [],
  logins: [],
  bills: "none",
  statement: false,
};

const errorOf = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

function toggled<T>(list: T[], value: T, on: boolean) {
  return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
}

function draftOf(r: RequestTypeView | null): Draft {
  if (!r) return { id: null, name: "", description: "", category: "Other", sortOrder: 1000, config: EMPTY_CONFIG, otherWorks: "" };
  const known = RETURN_WORKS.map((w) => w.key);
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    category: (REQUEST_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as Draft["category"]) : "Other",
    sortOrder: r.sortOrder,
    config: { ...r.config, returnWorks: r.config.returnWorks.filter((w) => known.includes(w)) },
    otherWorks: r.config.returnWorks.filter((w) => !known.includes(w)).join(", "),
  };
}

function summary(config: RequestConfig) {
  const parts: string[] = [];
  if (config.returnWorks.length && config.returnDocs.length) parts.push(`${config.returnWorks.map((w) => RETURN_WORKS.find((x) => x.key === w)?.label ?? w).join(", ")} files`);
  if (config.documents.length) parts.push(`${config.documents.length} document type${config.documents.length === 1 ? "" : "s"}${config.years > 1 ? `, ${config.years} years` : ""}`);
  if (config.details.length) parts.push(`${config.details.length} detail${config.details.length === 1 ? "" : "s"}`);
  if (config.logins.length) parts.push("portal logins");
  if (config.bills !== "none") parts.push(config.bills === "latest" ? "latest bill" : "bills of the period");
  if (config.statement) parts.push("statement of bills");
  if (config.range !== "none") parts.push(RANGE_OPTIONS[config.range].toLowerCase());
  return parts.join(" · ") || "Nothing picked";
}

export function RequestTypesEditor() {
  const [requests, setRequests] = useState<RequestTypeView[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/client-requests", { params: { all: 1 } });
      setRequests(data.requests);
      setIsAdmin(data.isAdmin);
    } catch (e) {
      toast.error(errorOf(e, "Failed to load the requests"));
      setRequests([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const replace = (row: RequestTypeView) => setRequests((list) => list?.map((r) => (r.id === row.id ? row : r)) ?? null);

  const patch = async (r: RequestTypeView, body: Record<string, unknown>) => {
    setBusy(r.id);
    try {
      const { data } = await axios.patch(`/api/client-requests/${r.id}`, body);
      replace(data.request);
    } catch (e) {
      toast.error(errorOf(e, "Could not save"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: RequestTypeView) => {
    if (!window.confirm(`Remove "${r.name}"?`)) return;
    setBusy(r.id);
    try {
      await axios.delete(`/api/client-requests/${r.id}`);
      setRequests((list) => list?.filter((x) => x.id !== r.id) ?? null);
    } catch (e) {
      toast.error(errorOf(e, "Could not remove"));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    const otherWorks = draft.otherWorks.split(",").map((w) => w.trim()).filter(Boolean);
    const body = {
      name: draft.name,
      description: draft.description.trim() || null,
      category: draft.category,
      sortOrder: draft.sortOrder,
      config: { ...draft.config, returnWorks: [...draft.config.returnWorks, ...otherWorks] },
    };
    setSaving(true);
    try {
      if (draft.id) {
        const { data } = await axios.patch(`/api/client-requests/${draft.id}`, body);
        replace(data.request);
      } else {
        const { data } = await axios.post("/api/client-requests", body);
        setRequests((list) => [...(list ?? []), data.request]);
      }
      setDraft(null);
      toast.success("Saved");
    } catch (e) {
      toast.error(errorOf(e, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const setConfig = (patch: Partial<RequestConfig>) => setDraft((d) => (d ? { ...d, config: { ...d.config, ...patch } } : d));

  if (!isAdmin) {
    return <p className="text-muted-foreground">Only Admin can change the Send to Client requests.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href="/dashboard/clients" aria-label="Back to clients">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Send to Client requests</h1>
            <p className="text-sm text-muted-foreground">The ready-made requests staff pick from. Requests with portal logins are Admin-only.</p>
          </div>
        </div>
        <Button onClick={() => setDraft(draftOf(null))}>
          <Plus className="mr-2 h-4 w-4" /> Add request
        </Button>
      </div>

      {requests === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        REQUEST_CATEGORIES.map((category) => {
          const list = requests.filter((r) => r.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
          if (list.length === 0) return null;
          return (
            <Card key={category}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{category}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {list.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {r.name}
                          {!r.key && <Badge variant="outline">Added</Badge>}
                          {r.adminOnly && <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-300">Admin only</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">{summary(r.config)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="mr-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch checked={r.active} disabled={busy === r.id} onCheckedChange={(v) => patch(r, { active: v })} /> {r.active ? "On" : "Off"}
                        </label>
                        <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setDraft(draftOf(r))}><Pencil className="h-4 w-4" /></Button>
                        {r.key ? (
                          <Button variant="ghost" size="icon" aria-label="Reset to default" title="Reset to default" disabled={busy === r.id} onClick={() => window.confirm(`Reset "${r.name}" to how it came?`) && patch(r, { reset: true })}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" aria-label="Remove" disabled={busy === r.id} onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit request" : "Add request"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label>Name</Label>
                  <Input value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Loan file for HDFC" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Description</Label>
                  <Input value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as Draft["category"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{REQUEST_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Order in the list</Label>
                  <Input type="number" min={0} max={10000} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })} />
                </div>
              </div>

              <section className="space-y-2">
                <h3 className="font-medium">Period and years</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Default period (returns, challans, bills)</Label>
                    <Select value={draft.config.range} onValueChange={(v) => setConfig({ range: v as RangeOption })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(RANGE_OPTIONS) as RangeOption[]).map((k) => <SelectItem key={k} value={k}>{RANGE_OPTIONS[k]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Yearly documents and ITRs: latest</Label>
                    <Select value={String(draft.config.years)} onValueChange={(v) => setConfig({ years: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <SelectItem key={n} value={String(n)}>{n === 1 ? "1 year" : `${n} years`}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Staff can change both before sending.</p>
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">Files from the compliance sheet</h3>
                <div className="grid gap-1 sm:grid-cols-3">
                  {RETURN_WORKS.map((w) => (
                    <label key={w.key} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={draft.config.returnWorks.includes(w.key)} onCheckedChange={(c) => setConfig({ returnWorks: toggled(draft.config.returnWorks, w.key, c === true) })} /> {w.label}
                    </label>
                  ))}
                </div>
                <Input value={draft.otherWorks} onChange={(e) => setDraft({ ...draft, otherWorks: e.target.value })} placeholder="Other works, by their name in Compliance → Setup (comma separated)" />
                <p className="text-xs text-muted-foreground">Which files of those works:</p>
                <div className="grid gap-1 sm:grid-cols-3">
                  {RETURN_DOC_KINDS.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={draft.config.returnDocs.includes(k)} onCheckedChange={(c) => setConfig({ returnDocs: toggled(draft.config.returnDocs, k, c === true) })} /> {RETURN_DOC_LABELS[k]}
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">Client documents</h3>
                {CLIENT_DOC_GROUPS.map((group) => (
                  <div key={group}>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{group}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {CLIENT_DOC_TYPES.filter((t) => t.group === group).map((t) => (
                        <label key={t.key} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={draft.config.documents.includes(t.key)} onCheckedChange={(c) => setConfig({ documents: toggled(draft.config.documents, t.key, c === true) })} />
                          {t.label}{t.yearly ? <span className="text-xs text-muted-foreground">(yearly)</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">Details in the email</h3>
                <div className="grid gap-1 sm:grid-cols-3">
                  {(Object.keys(DETAIL_FIELDS) as DetailField[]).map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={draft.config.details.includes(f)} onCheckedChange={(c) => setConfig({ details: toggled(draft.config.details, f, c === true) })} /> {DETAIL_FIELDS[f]}
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">Portal logins (makes the request Admin-only)</h3>
                <div className="grid gap-1 sm:grid-cols-3">
                  {(Object.keys(PORTALS) as Portal[]).map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={draft.config.logins.includes(p)} onCheckedChange={(c) => setConfig({ logins: toggled(draft.config.logins, p, c === true) })} /> {PORTALS[p].label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">A login is matched by its title under Credentials (e.g. &quot;GST portal&quot;, &quot;Income Tax&quot;, &quot;TRACES&quot;).</p>
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">Bills</h3>
                <div className="flex flex-wrap items-center gap-4">
                  <Select value={draft.config.bills} onValueChange={(v) => setConfig({ bills: v as RequestConfig["bills"] })}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No bill copies</SelectItem>
                      <SelectItem value="latest">Copy of the latest bill</SelectItem>
                      <SelectItem value="range">Copies of the bills of the period</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={draft.config.statement} onCheckedChange={(c) => setConfig({ statement: c === true })} /> Statement of bills of the period
                  </label>
                </div>
              </section>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !draft?.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

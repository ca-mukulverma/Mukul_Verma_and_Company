"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/billing-constants";
import { apiErrorMessage } from "./bill-types";

// Billing → Connectors: the people who bring clients. Their clients are
// billed in their own name, but the bills go to the connector's ledger in
// Tally and are emailed to the connector (see docs/BILLING.md).

interface Connector {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tallyLedgerName: string | null;
  ledgerName: string;
  active: boolean;
  clients: { id: string; name: string }[];
  bills: {
    id: string;
    billNumber: string | null;
    billDate: string | null;
    financialYear: string | null;
    fee: number;
    type: string | null;
    work: string;
    client: string | null;
    emailedAt: string | null;
  }[];
}

const emptyForm = { name: "", phone: "", email: "", tallyLedgerName: "" };

export function Connectors() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/billing/connectors");
      setConnectors(data.connectors);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load connectors"));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (c: Connector | null) => {
    setEditing(c ? c.id : "new");
    setForm(c ? { name: c.name, phone: c.phone ?? "", email: c.email ?? "", tallyLedgerName: c.tallyLedgerName ?? "" } : emptyForm);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        tallyLedgerName: form.tallyLedgerName.trim() || null,
      };
      if (editing === "new") await axios.post("/api/billing/connectors", body);
      else await axios.patch(`/api/billing/connectors/${editing}`, body);
      toast.success("Connector saved");
      setEditing(null);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not save the connector"));
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (c: Connector, active: boolean) => {
    try {
      await axios.patch(`/api/billing/connectors/${c.id}`, { active });
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  if (!connectors) return <Loader2 className="mx-auto mt-8 h-6 w-6 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Choose a client&apos;s connector on the client&apos;s page. Their bills are made out to the client, go to the connector&apos;s ledger in
          Tally, and are emailed to the connector. GST bills don&apos;t show the client&apos;s GSTIN (B2C) unless &quot;Show GSTIN&quot; is ticked on the bill.
        </p>
        <Button size="sm" onClick={() => startEdit(null)}><Plus className="mr-1 h-4 w-4" /> Add connector</Button>
      </div>

      {editing && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{editing === "new" ? "New connector" : "Edit connector"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Tally ledger name</Label>
              <Input maxLength={100} placeholder={form.name || "Same as the name"} value={form.tallyLedgerName} onChange={(e) => setForm({ ...form, tallyLedgerName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Mobile</Label>
              <Input inputMode="tel" maxLength={15} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Email (bills are sent here)</Label>
              <Input type="email" maxLength={75} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button disabled={saving || form.name.trim().length < 2} onClick={save}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {connectors.length === 0 && !editing && (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No connectors yet.</p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {connectors.map((c) => {
          const years = [...new Set(c.bills.map((b) => b.financialYear ?? ""))];
          return (
            <Card key={c.id} className={c.active ? undefined : "opacity-60"}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2"><Users className="h-4 w-4" /> {c.name}{!c.active && " (stopped)"}</span>
                  <span className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit" onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setActive(c, !c.active)}>{c.active ? "Stop" : "Restart"}</Button>
                  </span>
                </CardTitle>
                <CardDescription>
                  Ledger: {c.ledgerName}
                  {[c.phone, c.email].filter(Boolean).length > 0 && ` · ${[c.phone, c.email].filter(Boolean).join(" · ")}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Clients ({c.clients.length})</p>
                  <p>
                    {c.clients.length === 0
                      ? "None yet"
                      : c.clients.map((cl, i) => (
                          <span key={cl.id}>
                            {i > 0 && ", "}
                            <Link className="hover:underline" href={`/dashboard/clients/${cl.id}`}>{cl.name}</Link>
                          </span>
                        ))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {years.map((fy) => {
                    const ofYear = c.bills.filter((b) => (b.financialYear ?? "") === fy);
                    return (
                      <div key={fy} className="rounded-md border px-2 py-1 text-xs">
                        FY {fy || "–"}: {ofYear.length} bill{ofYear.length === 1 ? "" : "s"}, fees {formatRupees(ofYear.reduce((s, b) => s + b.fee, 0))}
                      </div>
                    );
                  })}
                </div>
                {c.bills.length > 0 && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setOpen((o) => (o === c.id ? null : c.id))}>
                      {open === c.id ? "Hide bills" : `Show bills (${c.bills.length})`}
                    </Button>
                    {open === c.id && (
                      <div className="max-h-80 overflow-auto rounded-md border">
                        <table className="w-full text-xs">
                          <thead className="bg-muted text-left">
                            <tr>
                              <th className="p-1.5">Bill</th>
                              <th className="p-1.5">Date</th>
                              <th className="p-1.5">Client</th>
                              <th className="p-1.5">Work</th>
                              <th className="p-1.5 text-right">Fee</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.bills.map((b) => (
                              <tr key={b.id} className="border-t">
                                <td className="whitespace-nowrap p-1.5 font-mono">{b.billNumber}</td>
                                <td className="whitespace-nowrap p-1.5">{b.billDate ? format(new Date(b.billDate), "d MMM yy") : ""}</td>
                                <td className="p-1.5">{b.client}</td>
                                <td className="max-w-[12rem] truncate p-1.5" title={b.work}>{b.work}</td>
                                <td className="whitespace-nowrap p-1.5 text-right">{formatRupees(b.fee)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Fees are before GST. To send the bills, select them in the Billing list and email them.</p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

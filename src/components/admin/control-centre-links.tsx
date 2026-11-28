"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, Link2, Loader2, MessageCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/components/billing/bill-types";

// Admin → Control Centre → Download links: a personal link to download the Desk app for one person, sent on WhatsApp.

interface Link {
  token: string;
  url: string;
  code: string;
  person: string;
  phone: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  downloads: number;
}
interface Desk {
  code: string;
  name: string;
  latest: string | null;
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const message = (l: Link, desks: Desk[]) => {
  const d = desks.find((x) => x.code === l.code);
  return (
    `Hello ${l.person}, here is your link to download ${d ? "Gudakesa Desk" : "the Desk"}${d?.latest ? ` ${d.latest}` : ""} ` +
    `from MVC & Company: ${l.url}\nOpen it on the Windows PC where Tally is used. The link works until ${when(l.expiresAt)}.`
  );
};

export function DownloadLinksTab() {
  const [data, setData] = useState<{ links: Link[]; desks: Desk[] } | null>(null);
  const [form, setForm] = useState({ code: "", person: "", phone: "", days: "7" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    axios
      .get("/api/admin/desk/links")
      .then((r) => {
        setData(r.data);
        setForm((f) => ({ ...f, code: f.code || r.data.desks[0]?.code || "" }));
      })
      .catch((e) => toast.error(apiErrorMessage(e, "Could not load")));
  }, []);
  useEffect(load, [load]);

  const whatsapp = (l: Link) => {
    const text = encodeURIComponent(message(l, data?.desks ?? []));
    window.open(l.phone ? `https://wa.me/${l.phone.length === 10 ? "91" + l.phone : l.phone}?text=${text}` : `https://wa.me/?text=${text}`, "_blank");
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await axios.post("/api/admin/desk/links", { ...form, days: Number(form.days) });
      toast.success("Link made");
      setForm({ ...form, person: "", phone: "" });
      load();
      whatsapp(r.data as Link);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (l: Link) => {
    if (!window.confirm(`Stop the link of ${l.person}? It stops working at once.`)) return;
    await axios.delete(`/api/admin/desk/links?token=${l.token}`).catch((e) => toast.error(apiErrorMessage(e)));
    load();
  };

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Give someone the app
          </CardTitle>
          <CardDescription>
            Makes a download link for one person. WhatsApp opens with the message ready. The link offers the newest
            version published for that client (Updates tab) and stops working after the days you choose.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-4">
          <div className="space-y-1">
            <Label>Client</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
              {data.desks.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name} {d.latest ? `(${d.latest})` : "(no version published)"}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Person&apos;s name</Label>
            <Input value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="e.g. Ankit" />
          </div>
          <div className="space-y-1">
            <Label>WhatsApp number (optional)</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98xxxxxxxx" />
          </div>
          <div className="space-y-1">
            <Label>Works for (days)</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
              {["1", "3", "7", "15", "30"].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <Button onClick={create} disabled={busy || !form.person.trim() || !form.code}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-1 h-4 w-4" />} Make link &amp; send on WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Links still working</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!data.links.length && <p className="text-muted-foreground">None</p>}
          {data.links.map((l) => (
            <div key={l.token} className="flex flex-wrap items-center gap-2 border-b pb-2">
              <b>{l.person}</b>
              <span className="text-muted-foreground">
                {l.code} · made {when(l.createdAt)} by {l.createdBy} · until {when(l.expiresAt)} · downloaded {l.downloads}×
              </span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(message(l, data.desks)).then(() => toast.success("Copied"))}>
                  <Copy className="mr-1 h-3 w-3" /> Copy message
                </Button>
                <Button size="sm" variant="outline" onClick={() => whatsapp(l)}>
                  <MessageCircle className="mr-1 h-3 w-3" /> WhatsApp
                </Button>
                <Button size="sm" variant="outline" onClick={() => revoke(l)}>
                  <Trash2 className="mr-1 h-3 w-3" /> Stop
                </Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

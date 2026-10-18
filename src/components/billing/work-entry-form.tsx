"use client";

import { useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CompanyValue } from "@/lib/billing-constants";
import { ClientOption, ClientPicker } from "./client-picker";
import { CompanySelect } from "./company-select";
import { apiErrorMessage } from "./bill-types";

// "Log work done" – replaces posting the work in the WhatsApp billing group
export function WorkEntryForm({ onLogged }: { onLogged?: () => void }) {
  const [company, setCompany] = useState<CompanyValue>("MVC");
  const [client, setClient] = useState<ClientOption | null>(null);
  const [description, setDescription] = useState("");
  const [workDate, setWorkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

  const valid = client && description.trim().length >= 3 && workDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await axios.post("/api/bills", {
        company,
        clientId: client.id,
        description: description.trim(),
        workDate: new Date(`${workDate}T12:00:00`).toISOString(),
        remark: remark.trim() || null,
      });
      toast.success("Work logged for billing");
      setClient(null);
      setDescription("");
      setRemark("");
      onLogged?.();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not log the work"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Log work done</CardTitle>
        <CardDescription>
          For work done outside a task in the app. It goes to the billing manager to be billed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label>Company</Label>
            <div><CompanySelect value={company} onChange={setCompany} /></div>
          </div>
          <div className="space-y-2">
            <Label>Client*</Label>
            <ClientPicker value={client} onChange={setClient} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="work-description">Work done*</Label>
            <Textarea
              id="work-description"
              placeholder="e.g. GSTR-3B filing for September 2026"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="work-date">Date of work*</Label>
            <Input id="work-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="w-auto" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="work-remark">Remark (optional)</Label>
            <Textarea id="work-remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Log work
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

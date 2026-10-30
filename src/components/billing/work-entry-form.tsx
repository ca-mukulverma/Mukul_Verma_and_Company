"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { CompanyValue } from "@/lib/billing-constants";
import { BillTo, BillToPicker, billToPayload, billToValid } from "./client-picker";
import { CompanySelect } from "./company-select";
import { apiErrorMessage } from "./bill-types";

// What "Log again" on an earlier entry fills the form with; a new key each time
export interface WorkPrefill {
  key: number;
  company: CompanyValue;
  billTo: BillTo;
  description: string;
}

interface WorkRow {
  key: number;
  billTo: BillTo;
  description: string;
  workDate: string;
}

// A recent bill of the same party for what looks like the same work
interface PossibleRepeat {
  id: string;
  work: string;
  workDate: string;
  stage: string;
  loggedBy: string;
}

let nextRowKey = 1;
const today = () => format(new Date(), "yyyy-MM-dd");
const emptyRow = (workDate = today()): WorkRow => ({
  key: nextRowKey++,
  billTo: { client: null, other: null },
  description: "",
  workDate,
});

// "Log work done" – replaces posting the work in the WhatsApp billing group.
// Several pieces of work can be logged together; each becomes its own bill.
export function WorkEntryForm({ onLogged, prefill }: { onLogged?: () => void; prefill?: WorkPrefill | null }) {
  const [company, setCompany] = useState<CompanyValue>("MVC");
  const [rows, setRows] = useState<WorkRow[]>(() => [emptyRow()]);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  // Admin and the billing managers are always told; these partners as well
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [notifyPartnerIds, setNotifyPartnerIds] = useState<string[]>([]);
  const [repeats, setRepeats] = useState<Record<number, PossibleRepeat[]>>({});
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    axios
      .get<{ users: { id: string; name: string }[] }>("/api/users", { params: { roles: "PARTNER", status: "active" } })
      .then((response) => setPartners(response.data.users.map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => setPartners([]));
  }, []);

  // "Log again": the same client and work, dated today, ready to adjust
  useEffect(() => {
    if (!prefill) return;
    setCompany(prefill.company);
    setRows([{ ...emptyRow(), billTo: prefill.billTo, description: prefill.description }]);
    setTimeout(() => descriptionRef.current?.focus(), 0);
  }, [prefill]);

  // Warns about work that may already be on its way to a bill
  const checkKey = useDebounce(
    useMemo(
      () =>
        JSON.stringify({
          company,
          keys: rows.map((row) => row.key),
          items: rows.map((row) => ({
            clientId: row.billTo.other ? null : row.billTo.client?.id ?? null,
            otherName: row.billTo.other?.name ?? null,
            description: row.description.trim(),
          })),
        }),
      [company, rows]
    ),
    600
  );
  useEffect(() => {
    const { keys, ...body } = JSON.parse(checkKey) as { keys: number[]; company: string; items: { description: string }[] };
    if (!body.items.some((item) => item.description.length >= 3)) {
      setRepeats({});
      return;
    }
    let cancelled = false;
    axios
      .post<{ matches: PossibleRepeat[][] }>("/api/bills/duplicates", body)
      .then((response) => {
        if (cancelled) return;
        setRepeats(Object.fromEntries(keys.map((key, i) => [key, response.data.matches[i] ?? []])));
      })
      .catch(() => !cancelled && setRepeats({}));
    return () => {
      cancelled = true;
    };
  }, [checkKey]);

  const togglePartner = (id: string) =>
    setNotifyPartnerIds(notifyPartnerIds.includes(id) ? notifyPartnerIds.filter((p) => p !== id) : [...notifyPartnerIds, id]);

  const updateRow = (key: number, change: Partial<WorkRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const rowValid = (row: WorkRow) => billToValid(row.billTo) && row.description.trim().length >= 3 && !!row.workDate;
  const valid = rows.every(rowValid);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await axios.post("/api/bills", {
        company,
        items: rows.map((row) => ({
          ...billToPayload(row.billTo),
          description: row.description.trim(),
          workDate: new Date(`${row.workDate}T12:00:00`).toISOString(),
        })),
        remark: remark.trim() || null,
        notifyPartnerIds,
      });
      toast.success(rows.length === 1 ? "Work logged for billing" : `${rows.length} pieces of work logged for billing`);
      setRows([emptyRow()]);
      setRemark("");
      setNotifyPartnerIds([]);
      setRepeats({});
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
          For work done outside a task in the app. It goes to the billing manager to be billed. Add several pieces of
          work at once with <strong>Add another</strong>; each becomes its own bill.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label>Company</Label>
            <div><CompanySelect value={company} onChange={setCompany} /></div>
          </div>

          {rows.map((row, index) => (
            <div key={row.key} className={rows.length > 1 ? "space-y-4 rounded-md border p-3" : "space-y-5"}>
              {rows.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Work {index + 1}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Remove work ${index + 1}`}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <Label>Client*</Label>
                <BillToPicker value={row.billTo} onChange={(billTo) => updateRow(row.key, { billTo })} />
                {index === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Not a saved client? Admins and partners can choose <strong>Add new client</strong> to add it to the
                    client master; anyone can choose <strong>Other</strong> and type the name to bill.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`work-description-${row.key}`}>Work done*</Label>
                <Textarea
                  id={`work-description-${row.key}`}
                  ref={index === 0 ? descriptionRef : undefined}
                  placeholder="e.g. GSTR-3B filing for September 2026"
                  value={row.description}
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                  className="min-h-[80px]"
                />
              </div>
              {(repeats[row.key]?.length ?? 0) > 0 && (
                <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-4 w-4" />Already on its way to a bill?
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {repeats[row.key].map((match) => (
                      <li key={match.id}>
                        “{match.work}” – {format(new Date(match.workDate), "d MMM yyyy")}, logged by {match.loggedBy} ({match.stage})
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs">Log it only if this is separate work.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor={`work-date-${row.key}`}>Date of work*</Label>
                <Input
                  id={`work-date-${row.key}`}
                  type="date"
                  value={row.workDate}
                  onChange={(e) => updateRow(row.key, { workDate: e.target.value })}
                  className="w-auto"
                />
              </div>
            </div>
          ))}

          {rows.length < 20 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              // The same client and date as the last one, which is the usual case
              onClick={() => {
                const last = rows[rows.length - 1];
                setRows([...rows, { ...emptyRow(last.workDate), billTo: last.billTo }]);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />Add another
            </Button>
          )}

          <div className="space-y-2">
            <Label htmlFor="work-remark">Remark (optional{rows.length > 1 ? ", for all of them" : ""})</Label>
            <Textarea id="work-remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          {partners.length > 0 && (
            <div className="space-y-2">
              <Label>Also notify partners (optional)</Label>
              <p className="text-xs text-muted-foreground">Admin and the billing managers are always notified.</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {partners.map((partner) => (
                  <label key={partner.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={notifyPartnerIds.includes(partner.id)}
                      onCheckedChange={() => togglePartner(partner.id)}
                    />
                    {partner.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rows.length === 1 ? "Log work" : `Log ${rows.length} pieces of work`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

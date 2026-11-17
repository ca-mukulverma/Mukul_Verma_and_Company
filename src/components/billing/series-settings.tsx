"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BILL_TYPE_LABELS, BillTypeValue, formatBillNumber } from "@/lib/billing-constants";
import { formatGstReturnNumber } from "@/lib/gst-return-number";
import { apiErrorMessage } from "./bill-types";

interface Series {
  type: BillTypeValue;
  financialYear: string;
  nextNumber: number;
  preview: string;
}

// The sequence typed in the field: a plain number ("219") or the whole bill
// number as printed ("26-27/0219", "HV/2026-27/5"), whose prefix must match the series
function parseNextNumber(type: BillTypeValue, financialYear: string, text: string): { value: number | null; error: string | null } {
  const typed = text.replace(/\s/g, "").toUpperCase();
  if (!typed) return { value: null, error: null };
  const slash = typed.lastIndexOf("/");
  const digits = typed.slice(slash + 1);
  if (!/^\d+$/.test(digits)) return { value: null, error: "End with the bill number, e.g. 219" };
  const value = Number(digits);
  if (value < 1 || value > 99999999) return { value: null, error: "The number should be 1 or more" };
  if (slash >= 0) {
    const expected = formatBillNumber(type, financialYear, value);
    const expectedPrefix = expected.slice(0, expected.lastIndexOf("/") + 1).toUpperCase();
    const typedPrefix = typed.slice(0, slash + 1);
    if (typedPrefix !== expectedPrefix) {
      return { value: null, error: `This series' bills start with ${expectedPrefix || "the number"}` };
    }
  }
  return { value, error: null };
}

// Admin sets the next bill number of each series, e.g. on go-live day
export function SeriesSettings() {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const apply = (rows: Series[]) => {
    setSeries(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.type, String(row.nextNumber)])));
  };

  useEffect(() => {
    axios
      .get<{ series: Series[] }>("/api/billing/series")
      .then((response) => apply(response.data.series))
      .catch((error) => {
        toast.error(apiErrorMessage(error, "Could not load bill series"));
        setSeries([]);
      });
  }, []);

  const save = async (type: BillTypeValue) => {
    setSaving(type);
    try {
      const response = await axios.put<{ series: Series[] }>("/api/billing/series", {
        type,
        nextNumber: parseNextNumber(type, series?.find((row) => row.type === type)?.financialYear ?? "", drafts[type] ?? "").value,
      });
      apply(response.data.series);
      toast.success("Next bill number saved");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Bill number series</CardTitle>
        <CardDescription>
          Each series restarts at 1 on 1 April. Before going live, set the next number to one more than the
          last bill issued by hand. Type just the number (219) or the full bill number (e.g. 26-27/0219).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {series.map((row) => {
              const parsed = parseNextNumber(row.type, row.financialYear, drafts[row.type] ?? "");
              const draft = parsed.value ?? 0;
              const validDraft = parsed.value !== null;
              return (
                <div key={row.type} className="space-y-2">
                  <p className="font-medium">{BILL_TYPE_LABELS[row.type]}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      type="text"
                      inputMode="text"
                      placeholder={`e.g. ${row.preview}`}
                      className="w-44 font-mono"
                      value={drafts[row.type] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [row.type]: e.target.value })}
                      aria-label={`Next number for ${BILL_TYPE_LABELS[row.type]}`}
                    />
                    <span className="text-sm text-muted-foreground">
                      Next bill: <span className="font-mono text-foreground">
                        {validDraft ? formatBillNumber(row.type, row.financialYear, draft) : row.preview}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!validDraft || draft === row.nextNumber || saving === row.type}
                      onClick={() => save(row.type)}
                    >
                      {saving === row.type && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                    </Button>
                  </div>
                  {parsed.error && <p className="text-xs text-red-600 dark:text-red-400">{parsed.error}</p>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface GstReturnSeriesRow {
  financialYear: string;
  nextNumber: number;
  preview: string;
  lastIssued: number | null;
}

// The number typed: "12" or the whole GST return number "GR/26-27/012"
function parseGstReturnNumber(financialYear: string, text: string): { value: number | null; error: string | null } {
  const typed = text.replace(/\s/g, "").toUpperCase();
  if (!typed) return { value: null, error: null };
  const slash = typed.lastIndexOf("/");
  const digits = typed.slice(slash + 1);
  if (!/^\d+$/.test(digits)) return { value: null, error: "End with the number, e.g. 12" };
  const value = Number(digits);
  if (value < 1 || value > 99999999) return { value: null, error: "The number should be 1 or more" };
  const prefix = `GR/${financialYear.slice(2)}/`;
  if (slash >= 0 && typed.slice(0, slash + 1) !== prefix) return { value: null, error: `This year's numbers start with ${prefix}` };
  return { value, error: null };
}

// Admin sets the next GST return number (docs/BILLING.md → GST return series):
// this financial year's, and next year's ahead of 1 April
export function GstReturnSeriesSettings() {
  const [series, setSeries] = useState<GstReturnSeriesRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const apply = (rows: GstReturnSeriesRow[]) => {
    setSeries(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.financialYear, String(row.nextNumber)])));
  };

  useEffect(() => {
    axios
      .get<{ series: GstReturnSeriesRow[] }>("/api/billing/gst-return/series")
      .then((response) => apply(response.data.series))
      .catch((error) => {
        toast.error(apiErrorMessage(error, "Could not load the GST return series"));
        setSeries([]);
      });
  }, []);

  const save = async (financialYear: string) => {
    setSaving(financialYear);
    try {
      const response = await axios.put<{ series: GstReturnSeriesRow[] }>("/api/billing/gst-return/series", {
        financialYear,
        nextNumber: parseGstReturnNumber(financialYear, drafts[financialYear] ?? "").value,
      });
      apply(response.data.series);
      toast.success("Next GST return number saved");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>GST return number series</CardTitle>
        <CardDescription>
          The numbers given to GST bills when they are pushed to the GST return (Billing → GST return). Used only in
          the GST return, never on bills or in Tally. Restarts every 1 April at the number set here (1 if none is set).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {series.map((row) => {
              const parsed = parseGstReturnNumber(row.financialYear, drafts[row.financialYear] ?? "");
              return (
                <div key={row.financialYear} className="space-y-2">
                  <p className="font-medium">Financial year {row.financialYear}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      type="text"
                      placeholder={`e.g. ${row.preview}`}
                      className="w-44 font-mono"
                      value={drafts[row.financialYear] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [row.financialYear]: e.target.value })}
                      aria-label={`Next GST return number for ${row.financialYear}`}
                    />
                    <span className="text-sm text-muted-foreground">
                      Next: <span className="font-mono text-foreground">
                        {parsed.value !== null ? formatGstReturnNumber(row.financialYear, parsed.value) : row.preview}
                      </span>
                      {row.lastIssued !== null && ` · last given ${formatGstReturnNumber(row.financialYear, row.lastIssued)}`}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={parsed.value === null || parsed.value === row.nextNumber || saving === row.financialYear}
                      onClick={() => save(row.financialYear)}
                    >
                      {saving === row.financialYear && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                    </Button>
                  </div>
                  {parsed.error && <p className="text-xs text-red-600 dark:text-red-400">{parsed.error}</p>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

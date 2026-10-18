"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BILL_TYPE_LABELS, BillTypeValue, formatBillNumber } from "@/lib/billing-constants";
import { apiErrorMessage } from "./bill-types";

interface Series {
  type: BillTypeValue;
  financialYear: string;
  nextNumber: number;
  preview: string;
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
        nextNumber: Number(drafts[type]),
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
          last bill issued by hand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {series.map((row) => {
              const draft = Number(drafts[row.type]);
              const validDraft = Number.isInteger(draft) && draft >= 1;
              return (
                <div key={row.type} className="space-y-2">
                  <p className="font-medium">{BILL_TYPE_LABELS[row.type]}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      className="w-36"
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
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

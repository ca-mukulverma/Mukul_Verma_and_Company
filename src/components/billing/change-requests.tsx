"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BILL_TYPE_LABELS, BillTypeValue, CompanyValue, formatRupees } from "@/lib/billing-constants";
import { CompanyBadge } from "./company-select";
import { apiErrorMessage, BillChanges, billParty, CHANGE_KIND_LABELS } from "./bill-types";

interface ChangeRequest {
  id: string;
  kind: "edit" | "cancel" | "reissue";
  reason: string;
  changes: BillChanges | null;
  createdAt: string;
  requestedBy: { id: string; name: string };
  bill: {
    id: string;
    company: CompanyValue;
    type: BillTypeValue | null;
    billNumber: string | null;
    billDate: string | null;
    amount: number | null;
    description: string;
    workDate: string;
    client: { id: string; contactPerson: string; companyName: string | null } | null;
    billToName: string | null;
  };
  newClient: { id: string; contactPerson: string; companyName: string | null } | null;
}

// Pending edit/cancel/reissue requests. Admin decides; billing managers can
// see what is waiting.
export function ChangeRequests({ canDecide, onChanged }: { canDecide: boolean; onChanged?: () => void }) {
  const [requests, setRequests] = useState<ChangeRequest[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await axios.get<{ requests: ChangeRequest[] }>("/api/bills/change-requests");
      setRequests(response.data.requests);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load requests"));
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (requests === null) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (requests.length === 0) {
    return <p className="text-center text-sm text-muted-foreground py-12">No requests are waiting.</p>;
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          canDecide={canDecide}
          onDecided={() => {
            load();
            onChanged?.();
          }}
        />
      ))}
    </div>
  );
}

function RequestCard({
  request,
  canDecide,
  onDecided,
}: {
  request: ChangeRequest;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState<"approve" | "reject" | null>(null);
  const { bill, changes } = request;

  const decide = async (decision: "approve" | "reject") => {
    setSaving(decision);
    try {
      await axios.post(`/api/bills/change-requests/${request.id}`, { decision, remark: remark.trim() || undefined });
      toast.success(decision === "approve" ? "Request approved" : "Request rejected");
      onDecided();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  // Current value → requested value, for each value the request changes
  const rows: { label: string; from: string; to: string }[] = [];
  if (changes?.amount !== undefined) {
    rows.push({ label: "Fee", from: bill.amount !== null ? formatRupees(bill.amount) : "—", to: formatRupees(changes.amount) });
  }
  if (changes?.description !== undefined) {
    rows.push({ label: "Work done", from: bill.description, to: changes.description });
  }
  if (changes?.workDate !== undefined) {
    rows.push({
      label: "Date of work",
      from: format(new Date(bill.workDate), "d MMM yyyy"),
      to: format(new Date(changes.workDate), "d MMM yyyy"),
    });
  }
  if (changes?.type !== undefined) {
    rows.push({ label: "Bill type", from: bill.type ? BILL_TYPE_LABELS[bill.type] : "—", to: BILL_TYPE_LABELS[changes.type] });
  }
  if (changes?.clientId !== undefined) {
    rows.push({ label: "Client", from: billParty(bill) ?? "—", to: request.newClient ? request.newClient.companyName || request.newClient.contactPerson : "—" });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={request.kind === "cancel" ? "destructive" : "default"}>{CHANGE_KIND_LABELS[request.kind]}</Badge>
          <CompanyBadge company={bill.company} />
          <span className="font-mono font-medium">{bill.billNumber}</span>
          {bill.billDate && <span className="text-sm text-muted-foreground">dated {format(new Date(bill.billDate), "d MMM yyyy")}</span>}
        </div>
        <div>
          <p className="font-medium">{billParty(bill) ?? "No client"}</p>
          <p className="text-sm">{bill.description.split("\n")[0]}</p>
          {bill.amount !== null && <p className="text-sm text-muted-foreground">Fee {formatRupees(bill.amount)}</p>}
        </div>

        {rows.length > 0 && (
          <div className="rounded-md border text-sm divide-y">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_1fr] gap-1 sm:gap-3 p-2">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="line-through text-muted-foreground whitespace-pre-line break-words">{row.from}</span>
                <span className="font-medium whitespace-pre-line break-words">{row.to}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm">
          <span className="text-muted-foreground">Reason from {request.requestedBy.name}:</span> {request.reason}
        </p>

        {canDecide && (
          <div className="space-y-2">
            <Textarea
              placeholder="Remark (optional)"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="min-h-[60px]"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={saving !== null} onClick={() => decide("approve")}>
                {saving === "approve" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                Approve {CHANGE_KIND_LABELS[request.kind].toLowerCase()}
              </Button>
              <Button size="sm" variant="outline" disabled={saving !== null} onClick={() => decide("reject")}>
                {saving === "reject" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1 h-3.5 w-3.5" />}
                Reject
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

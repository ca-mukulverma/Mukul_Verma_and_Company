"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { CheckCheck, IndianRupee, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPANY_LABELS, CompanyValue } from "@/lib/billing-constants";
import { CompanyBadge } from "./company-select";

interface Summary {
  manages: CompanyValue[];
  awaitingMyAmount: {
    id: string;
    company: CompanyValue;
    description: string;
    client: { contactPerson: string; companyName: string | null } | null;
  }[];
  awaitingMyAmountCount: number;
  counts: Record<string, Record<string, number>>;
  isAdmin: boolean;
  awaitingFinalCount: number;
  pendingChangeRequests: number;
}

const STAGES = [
  { status: "draft", label: "Drafts" },
  { status: "awaiting_amount", label: "Awaiting amount" },
  { status: "amount_entered", label: "Amount entered" },
  { status: "manager_approved", label: "Final approval" },
];

// Dashboard card for partners and admins: bills waiting for their amount and,
// for billing managers, how many bills are at each stage
export function BillingDashboardCard() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    axios
      .get<Summary>("/api/bills/summary")
      .then((response) => setSummary(response.data))
      .catch(() => setSummary(null));
  }, []);

  if (!summary || (summary.awaitingMyAmountCount === 0 && summary.manages.length === 0)) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className="h-5 w-5" />Billing
        </CardTitle>
        <CardDescription>Bills that need you</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {summary.isAdmin && (summary.awaitingFinalCount > 0 || summary.pendingChangeRequests > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <div className="text-sm">
              {summary.awaitingFinalCount > 0 && (
                <p className="font-medium">
                  {summary.awaitingFinalCount} bill{summary.awaitingFinalCount === 1 ? "" : "s"} waiting for your final approval
                </p>
              )}
              {summary.pendingChangeRequests > 0 && (
                <p className="font-medium">
                  {summary.pendingChangeRequests} edit/cancel/reissue request{summary.pendingChangeRequests === 1 ? "" : "s"}
                </p>
              )}
              <p className="text-muted-foreground">Bills are dated on the day you approve them. Approve before the month ends.</p>
            </div>
            <div className="flex gap-2">
              {summary.awaitingFinalCount > 0 && (
                <Button asChild size="sm">
                  <Link href="/dashboard/billing?tab=final"><CheckCheck className="mr-1 h-3.5 w-3.5" />Approve</Link>
                </Button>
              )}
              {summary.pendingChangeRequests > 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/billing?tab=requests">Requests</Link>
                </Button>
              )}
            </div>
          </div>
        )}

        {summary.awaitingMyAmountCount > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium">Bills awaiting your amount ({summary.awaitingMyAmountCount})</p>
              <Button asChild size="sm">
                <Link href="/dashboard/billing?tab=amounts"><IndianRupee className="mr-1 h-3.5 w-3.5" />Enter amounts</Link>
              </Button>
            </div>
            <ul className="divide-y rounded-md border">
              {summary.awaitingMyAmount.map((bill) => (
                <li key={bill.id} className="flex items-center gap-2 p-2 text-sm">
                  <CompanyBadge company={bill.company} />
                  <span className="font-medium shrink-0">
                    {bill.client ? bill.client.companyName || bill.client.contactPerson : "No client"}
                  </span>
                  <span className="truncate text-muted-foreground">{bill.description.split("\n")[0]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.manages.map((company) => {
          const counts = summary.counts[company] || {};
          return (
            <div key={company} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{COMPANY_LABELS[company]} bills</p>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/dashboard/billing?tab=${company === "MVC" ? "mvc" : "bedge"}`}>Open</Link>
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {STAGES.map((stage) => (
                  <div key={stage.status} className="rounded-md border p-2 text-center">
                    <p className="text-xl font-semibold">{counts[stage.status] || 0}</p>
                    <p className="text-xs text-muted-foreground">{stage.label}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

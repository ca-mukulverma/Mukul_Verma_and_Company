"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillList } from "@/components/billing/bill-list";
import { SeriesSettings } from "@/components/billing/series-settings";
import { WorkEntryForm } from "@/components/billing/work-entry-form";
import { CompanyValue } from "@/lib/billing-constants";

export interface BillingSummary {
  manages: CompanyValue[];
  canEnterAmounts: boolean;
  isAdmin: boolean;
  awaitingMyAmountCount: number;
  counts: Record<string, Record<string, number>>;
}

function CountBadge({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{count}</span>;
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageContent />
    </Suspense>
  );
}

function BillingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  // Bumped after logging work so "My entries" reloads
  const [entriesVersion, setEntriesVersion] = useState(0);

  const loadSummary = useCallback(async () => {
    try {
      const response = await axios.get<BillingSummary>("/api/bills/summary");
      setSummary(response.data);
    } catch {
      setSummary({ manages: [], canEnterAmounts: false, isAdmin: false, awaitingMyAmountCount: 0, counts: {} });
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (!summary) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs = [
    ...(summary.canEnterAmounts ? ["amounts"] : []),
    ...(summary.manages.includes("MVC") ? ["mvc"] : []),
    ...(summary.manages.includes("BEDGE") ? ["bedge"] : []),
    "log",
    "mine",
    ...(summary.isAdmin ? ["series"] : []),
  ];
  const defaultTab =
    summary.awaitingMyAmountCount > 0
      ? "amounts"
      : summary.manages.includes("MVC")
        ? "mvc"
        : summary.manages.includes("BEDGE")
          ? "bedge"
          : "log";
  const requestedTab = searchParams.get("tab");
  const tab = requestedTab && tabs.includes(requestedTab) ? requestedTab : defaultTab;

  const pendingCount = (company: CompanyValue) => {
    const counts = summary.counts[company] || {};
    return (counts.draft || 0) + (counts.amount_entered || 0);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Work done for clients, on its way to a bill.</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => router.replace(`/dashboard/billing?tab=${value}`, { scroll: false })}>
        <div className="overflow-x-auto">
          <TabsList>
            {summary.canEnterAmounts && (
              <TabsTrigger value="amounts">
                Awaiting my amount<CountBadge count={summary.awaitingMyAmountCount} />
              </TabsTrigger>
            )}
            {summary.manages.includes("MVC") && (
              <TabsTrigger value="mvc">MVC bills<CountBadge count={pendingCount("MVC")} /></TabsTrigger>
            )}
            {summary.manages.includes("BEDGE") && (
              <TabsTrigger value="bedge">B Edge bills<CountBadge count={pendingCount("BEDGE")} /></TabsTrigger>
            )}
            <TabsTrigger value="log">Log work</TabsTrigger>
            <TabsTrigger value="mine">My entries</TabsTrigger>
            {summary.isAdmin && <TabsTrigger value="series">Number series</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="amounts" className="mt-4">
          <BillList mode="amounts" onChanged={loadSummary} />
        </TabsContent>
        <TabsContent value="mvc" className="mt-4">
          <BillList mode="manage" company="MVC" counts={summary.counts.MVC} onChanged={loadSummary} />
        </TabsContent>
        <TabsContent value="bedge" className="mt-4">
          <BillList mode="manage" company="BEDGE" counts={summary.counts.BEDGE} onChanged={loadSummary} />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <WorkEntryForm
            onLogged={() => {
              setEntriesVersion((v) => v + 1);
              loadSummary();
            }}
          />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <BillList key={entriesVersion} mode="mine" />
        </TabsContent>
        {summary.isAdmin && (
          <TabsContent value="series" className="mt-4">
            <SeriesSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

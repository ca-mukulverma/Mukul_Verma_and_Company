"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { CalendarClock, ChevronDown, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpLink } from "@/components/help/help-link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillList } from "@/components/billing/bill-list";
import { BillingRegister } from "@/components/billing/billing-register";
import { ChangeRequests } from "@/components/billing/change-requests";
import { ClearBillingData } from "@/components/billing/clear-billing-data";
import { Connectors } from "@/components/billing/connectors";
import { BillingAlert } from "@/components/billing/billing-alert";
import { EmailSettings } from "@/components/billing/email-settings";
import { EntityProfiles } from "@/components/billing/entity-profiles";
import { TallyExport } from "@/components/billing/tally-export";
import { cn } from "@/lib/utils";
import { SeriesSettings } from "@/components/billing/series-settings";
import { WorkEntryForm, WorkPrefill } from "@/components/billing/work-entry-form";
import { BillTypeValue, CompanyValue } from "@/lib/billing-constants";

export interface BillingSummary {
  manages: CompanyValue[];
  // Companies whose Billing List the user sees (a partner may see it without managing)
  listCompanies: CompanyValue[];
  // Bill types whose Billing List the user sees
  listTypes: BillTypeValue[];
  canEnterAmounts: boolean;
  isAdmin: boolean;
  awaitingMyAmountCount: number;
  counts: Record<string, Record<string, number>>;
  awaitingFinalCount: number;
  pendingChangeRequests: number;
  // Numbered bills to send (again) to Tally
  tallyDueCount: number;
}

// Bills are dated on the day Admin approves them, so this reminds Admin to
// approve before the month ends
function MonthEndNotice({ waiting }: { waiting: number }) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const lastDay = new Date(year, month, 0).getDate();
  const daysLeft = lastDay - day;
  const monthName = new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long" });
  const urgent = waiting > 0 && daysLeft <= 6;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border p-3 text-sm",
        urgent
          ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      )}
    >
      <CalendarClock className="h-5 w-5 shrink-0" />
      <div>
        <p className="font-medium">Bills are dated on the day you give final approval.</p>
        <p>
          Approve all pending bills by {lastDay} {monthName} so they are dated this month.{" "}
          {daysLeft === 0 ? "Today is the last day of the month." : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`}
          {waiting > 0 && ` ${waiting} bill${waiting === 1 ? " is" : "s are"} waiting.`}
        </p>
      </div>
    </div>
  );
}

function CountBadge({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{count}</span>;
}

// Bills with partners for the amount: not the manager's turn, but worth seeing
function WithPartnersBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-muted-foreground" title={`${count} with partners for the amount`}>
      +{count} with partners
    </span>
  );
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
  // "Log again" on an entry fills the Log work form
  const [prefill, setPrefill] = useState<WorkPrefill | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const response = await axios.get<BillingSummary>("/api/bills/summary");
      setSummary(response.data);
    } catch {
      setSummary({
        manages: [],
        listCompanies: [],
        listTypes: [],
        canEnterAmounts: false,
        isAdmin: false,
        awaitingMyAmountCount: 0,
        counts: {},
        awaitingFinalCount: 0,
        pendingChangeRequests: 0,
        tallyDueCount: 0,
      });
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

  const isManager = summary.manages.length > 0;
  const seesList = summary.listCompanies.length > 0;
  const tabs = [
    ...(summary.isAdmin ? ["final"] : []),
    ...(summary.canEnterAmounts ? ["amounts"] : []),
    ...(summary.manages.includes("MVC") ? ["mvc"] : []),
    ...(summary.manages.includes("BEDGE") ? ["bedge"] : []),
    ...(seesList ? ["list"] : []),
    ...(isManager ? ["tally", "connectors", "requests"] : []),
    "log",
    "mine",
    ...(summary.isAdmin ? ["series", "profiles", "emails", "clear"] : []),
  ];
  const defaultTab =
    summary.isAdmin && summary.awaitingFinalCount > 0
      ? "final"
      : summary.awaitingMyAmountCount > 0
      ? "amounts"
      : summary.manages.includes("MVC")
        ? "mvc"
        : summary.manages.includes("BEDGE")
          ? "bedge"
          : seesList
            ? "list"
            : "log";
  const requestedTab = searchParams.get("tab");
  const tab = requestedTab && tabs.includes(requestedTab) ? requestedTab : defaultTab;
  const goTo = (value: string) => router.replace(`/dashboard/billing?tab=${value}`, { scroll: false });
  // Used now and then: kept out of the tab bar
  const settingsTabs: { value: string; label: string; count?: number }[] = [
    ...(isManager
      ? [
          { value: "tally", label: "Tally export", count: summary.tallyDueCount },
          { value: "connectors", label: "Connectors" },
        ]
      : []),
    ...(summary.isAdmin
      ? [
          { value: "series", label: "Number series" },
          { value: "profiles", label: "Company profiles" },
          { value: "emails", label: "Bill emails" },
          { value: "clear", label: "Clear data" },
        ]
      : []),
  ];
  const activeSetting = settingsTabs.find((s) => s.value === tab);

  const pendingCount = (company: CompanyValue) => {
    const counts = summary.counts[company] || {};
    return (counts.draft || 0) + (counts.amount_entered || 0);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <HelpLink section="billing" />
        </div>
        <p className="text-muted-foreground">Work done for clients, on its way to a bill.</p>
      </div>
      <BillingAlert />

      <Tabs value={tab} onValueChange={goTo}>
        {/* Everyday work in the tabs; setup and Tally in the Billing settings menu.
            w-0 + min-w-full: the bar scrolls sideways on phones instead of widening the page */}
        <div className="flex w-0 min-w-full items-center gap-2 overflow-x-auto">
          <TabsList>
            {summary.canEnterAmounts && (
              <TabsTrigger value="amounts">
                Awaiting my amount<CountBadge count={summary.awaitingMyAmountCount} />
              </TabsTrigger>
            )}
            {summary.manages.includes("MVC") && (
              <TabsTrigger value="mvc">
                MVC bills<CountBadge count={pendingCount("MVC")} />
                <WithPartnersBadge count={summary.counts.MVC?.awaiting_amount} />
              </TabsTrigger>
            )}
            {summary.manages.includes("BEDGE") && (
              <TabsTrigger value="bedge">
                B Edge bills<CountBadge count={pendingCount("BEDGE")} />
                <WithPartnersBadge count={summary.counts.BEDGE?.awaiting_amount} />
              </TabsTrigger>
            )}
            {summary.isAdmin && (
              <TabsTrigger value="final">Final approval<CountBadge count={summary.awaitingFinalCount} /></TabsTrigger>
            )}
            {/* Only when a request is waiting (or the tab is open from a link) */}
            {isManager && (summary.pendingChangeRequests > 0 || tab === "requests") && (
              <TabsTrigger value="requests">Change requests<CountBadge count={summary.pendingChangeRequests} /></TabsTrigger>
            )}
            {seesList && <TabsTrigger value="list">Billing list</TabsTrigger>}
            <TabsTrigger value="log">Log work</TabsTrigger>
            <TabsTrigger value="mine">My entries</TabsTrigger>
          </TabsList>
          {settingsTabs.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={activeSetting ? "secondary" : "outline"} size="sm" className="shrink-0">
                  <Settings2 className="mr-1 h-4 w-4" />
                  {activeSetting ? activeSetting.label : "Billing settings"}
                  {!activeSetting && <CountBadge count={settingsTabs.reduce((n, s) => n + (s.count ?? 0), 0)} />}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {settingsTabs.map((s) => (
                  <DropdownMenuItem key={s.value} onClick={() => goTo(s.value)}>
                    {s.label}
                    {s.count ? <span className="ml-auto pl-3 text-xs text-muted-foreground">{s.count} due</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {summary.isAdmin && (
          <TabsContent value="final" className="mt-4 space-y-4">
            <MonthEndNotice waiting={summary.awaitingFinalCount} />
            <BillList mode="final" onChanged={loadSummary} />
          </TabsContent>
        )}
        <TabsContent value="amounts" className="mt-4">
          <BillList mode="amounts" onChanged={loadSummary} />
        </TabsContent>
        <TabsContent value="mvc" className="mt-4">
          <BillList mode="manage" company="MVC" counts={summary.counts.MVC} onChanged={loadSummary} />
        </TabsContent>
        <TabsContent value="bedge" className="mt-4">
          <BillList mode="manage" company="BEDGE" counts={summary.counts.BEDGE} onChanged={loadSummary} />
        </TabsContent>
        {seesList && (
          <TabsContent value="list" className="mt-4 min-w-0">
            <BillingRegister types={summary.listTypes} onChanged={loadSummary} />
          </TabsContent>
        )}
        {isManager && (
          <TabsContent value="tally" className="mt-4 min-w-0">
            <TallyExport isAdmin={summary.isAdmin} />
          </TabsContent>
        )}
        {isManager && (
          <TabsContent value="connectors" className="mt-4 min-w-0">
            <Connectors />
          </TabsContent>
        )}
        {isManager && (
          <TabsContent value="requests" className="mt-4">
            <ChangeRequests canDecide={summary.isAdmin} onChanged={loadSummary} />
          </TabsContent>
        )}
        <TabsContent value="log" className="mt-4">
          <WorkEntryForm
            prefill={prefill}
            onLogged={() => {
              setEntriesVersion((v) => v + 1);
              loadSummary();
            }}
          />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <BillList
            key={entriesVersion}
            mode="mine"
            onLogAgain={(bill) => {
              setPrefill({
                key: Date.now(),
                company: bill.company,
                billTo: {
                  client: bill.client,
                  other: !bill.client && bill.billToName
                    ? { name: bill.billToName, address: bill.billToAddress ?? "", gstin: bill.billToGstin ?? "" }
                    : null,
                },
                description: bill.description,
              });
              goTo("log");
            }}
          />
        </TabsContent>
        {summary.isAdmin && (
          <TabsContent value="series" className="mt-4">
            <SeriesSettings />
          </TabsContent>
        )}
        {summary.isAdmin && (
          <TabsContent value="profiles" className="mt-4">
            <EntityProfiles />
          </TabsContent>
        )}
        {summary.isAdmin && (
          <TabsContent value="emails" className="mt-4">
            <EmailSettings />
          </TabsContent>
        )}
        {summary.isAdmin && (
          <TabsContent value="clear" className="mt-4">
            <ClearBillingData onCleared={loadSummary} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

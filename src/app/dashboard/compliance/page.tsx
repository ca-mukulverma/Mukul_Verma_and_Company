"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComplianceOverview } from "@/components/compliance/overview";
import { ComplianceSheet } from "@/components/compliance/sheet";
import { ClientsPanel } from "@/components/compliance/clients-panel";
import { ComplianceReco } from "@/components/compliance/reco";
import { GstWorking } from "@/components/compliance/gst-working";
import { ComplianceSetup, WorkType } from "@/components/compliance/setup";
import { apiError } from "@/components/compliance/types";

// Recurring compliance work: GST, TDS, ITR, advance tax and any other regular
// work. See docs/COMPLIANCE.md.
export default function CompliancePage() {
  return (
    <Suspense>
      <CompliancePageContent />
    </Suspense>
  );
}

const TABS = ["overview", "gst", "tds", "work", "gstWorking", "reco", "clients", "setup"] as const;
type Tab = (typeof TABS)[number];

function CompliancePageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const isManager = session?.user?.role === "ADMIN" || session?.user?.role === "PARTNER";
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== "setup" || isManager) ? requested : "overview";
  const [workTypes, setWorkTypes] = useState<WorkType[] | null>(null);
  const [workSheetType, setWorkSheetType] = useState<string | null>(null);

  const loadWorkTypes = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/compliance/work-types");
      setWorkTypes(data.workTypes);
    } catch (error) {
      toast.error(apiError(error, "Could not load compliance work"));
    }
  }, []);
  useEffect(() => {
    loadWorkTypes();
  }, [loadWorkTypes]);

  const setTab = (next: string) => {
    const search = new URLSearchParams(params.toString());
    search.set("tab", next);
    if (next !== "clients") search.delete("client");
    router.replace(`/dashboard/compliance?${search.toString()}`, { scroll: false });
  };

  const openSheet = (kind: string, workTypeId: string) => {
    if (kind === "GSTR1" || kind === "GSTR3B") setTab("gst");
    else if (kind === "TDS_PAYMENT" || kind === "TDS_RETURN") setTab("tds");
    else {
      setWorkSheetType(workTypeId);
      setTab("work");
    }
  };

  return (
    // contain:inline-size keeps wide sheets from stretching the dashboard
    // layout; they scroll sideways inside the page instead
    <div className="space-y-4 p-1 [contain:inline-size] md:p-2">
      <div>
        <h1 className="text-2xl font-bold">Compliance</h1>
        <p className="text-sm text-muted-foreground">
          Recurring GST, TDS, ITR and other work for every client in one place. Click any cell in a sheet to update it.
        </p>
      </div>
      {!workTypes ? (
        <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin" />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="gst">GST sheet</TabsTrigger>
            <TabsTrigger value="tds">TDS sheet</TabsTrigger>
            <TabsTrigger value="work">Other work</TabsTrigger>
            <TabsTrigger value="gstWorking">GST working</TabsTrigger>
            <TabsTrigger value="reco">Reconciliation</TabsTrigger>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            {isManager && <TabsTrigger value="setup">Setup</TabsTrigger>}
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <ComplianceOverview onOpenSheet={openSheet} />
          </TabsContent>
          <TabsContent value="gst" className="mt-4">
            <ComplianceSheet view="gst" workTypes={workTypes} isManager={isManager} />
          </TabsContent>
          <TabsContent value="tds" className="mt-4">
            <ComplianceSheet view="tds" workTypes={workTypes} isManager={isManager} />
          </TabsContent>
          <TabsContent value="work" className="mt-4">
            <ComplianceSheet key={workSheetType ?? "work"} view="work" workTypes={workTypes} isManager={isManager} initialWorkTypeId={workSheetType} />
          </TabsContent>
          <TabsContent value="gstWorking" className="mt-4">
            <GstWorking workTypes={workTypes} isManager={isManager} />
          </TabsContent>
          <TabsContent value="reco" className="mt-4">
            <ComplianceReco isManager={isManager} />
          </TabsContent>
          <TabsContent value="clients" className="mt-4">
            <ClientsPanel workTypes={workTypes} isManager={isManager} initialClientId={params.get("client")} />
          </TabsContent>
          {isManager && (
            <TabsContent value="setup" className="mt-4">
              <ComplianceSetup workTypes={workTypes} onChanged={loadWorkTypes} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

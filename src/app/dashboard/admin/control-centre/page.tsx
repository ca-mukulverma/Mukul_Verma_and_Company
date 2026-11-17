"use client";

import { useSession } from "next-auth/react";
import { ControlCentre } from "@/components/admin/control-centre";

// Admin → Control Centre: desktop software at clients, rules and daily reports
// (docs/CONTROL_CENTRE.md)
export default function ControlCentrePage() {
  const { data: session } = useSession();
  if (session?.user?.role !== "ADMIN") {
    return <p className="text-sm text-muted-foreground">Only Admin can use the Control Centre.</p>;
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Control Centre</h1>
        <p className="text-sm text-muted-foreground">
          Clients&apos; desktop accounting software: daily reports, the rates and limits they use, and their access.
        </p>
      </div>
      <ControlCentre />
    </div>
  );
}

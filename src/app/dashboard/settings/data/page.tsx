"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Backups } from "@/components/admin/backups";
import { FreshStart } from "@/components/admin/fresh-start";

// Settings → Data (Admin): backups and fresh start
export default function DataSettingsPage() {
  const { data: session } = useSession();
  // A fresh start adds a backup to the list
  const [version, setVersion] = useState(0);

  if (session?.user?.role !== "ADMIN") {
    return <p className="text-sm text-muted-foreground">Only Admin can manage backups and data.</p>;
  }
  return (
    <div className="max-w-3xl space-y-6">
      <Backups key={version} />
      <FreshStart onDone={() => setVersion((v) => v + 1)} />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { DatabaseBackup, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiErrorMessage } from "@/components/billing/bill-types";

export interface Backup {
  id: string;
  name: string;
  createdAt: string;
  manual: boolean;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// Admin takes a copy of the whole database in Neon with one click
export function Backups() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [taking, setTaking] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    axios
      .get<{ configured: boolean; backups: Backup[] }>("/api/admin/backups")
      .then((response) => {
        setConfigured(response.data.configured);
        setBackups(response.data.backups);
      })
      .catch((error) => toast.error(apiErrorMessage(error, "Could not load backups")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const take = async () => {
    setTaking(true);
    try {
      await axios.post("/api/admin/backups");
      toast.success("Backup taken");
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "The backup failed"));
    } finally {
      setTaking(false);
    }
  };

  const remove = async (backup: Backup) => {
    if (!window.confirm(`Delete the backup "${backup.name}"? It can't be brought back.`)) return;
    setDeleting(backup.id);
    try {
      await axios.delete(`/api/admin/backups?id=${encodeURIComponent(backup.id)}`);
      toast.success("Backup deleted");
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5" /> Backups
        </CardTitle>
        <CardDescription>
          A backup is a copy of all the app&apos;s data (clients, tasks, compliance, bills, users) kept in Neon. Take one
          before any big change. Files in storage are not part of it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {configured === false ? (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">Backups are not set up yet</p>
            <p>
              In Neon: Account settings → API keys → Create a key. In Vercel: Settings → Environment Variables, add{" "}
              <code>NEON_API_KEY</code> (the key) and <code>NEON_PROJECT_ID</code> (Neon → Settings → Project ID), then
              redeploy.
            </p>
          </div>
        ) : (
          <Button onClick={take} disabled={taking || configured === null}>
            {taking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseBackup className="mr-2 h-4 w-4" />}
            Take backup now
          </Button>
        )}

        {backups.length > 0 && (
          <ul className="divide-y rounded-md border">
            {backups.map((b) => (
              <li key={b.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {when(b.createdAt)}
                    {!b.manual && " · automatic"}
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${b.name}`}
                  disabled={deleting === b.id}
                  onClick={() => remove(b)}
                >
                  {deleting === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          To go back to a backup: Neon console → the project → Backup &amp; restore → choose the backup → Restore. This
          replaces all current data, so it is done there on purpose and not from the app.
        </p>
      </CardContent>
    </Card>
  );
}

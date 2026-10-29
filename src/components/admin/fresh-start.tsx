"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/components/billing/bill-types";

interface Counts {
  clients: number;
  tasks: number;
  bills: number;
  complianceItems: number;
  complianceDocuments: number;
  credentials: number;
  notifications: number;
  activities: number;
}

const CONFIRM_WORD = "FRESH START";

// Admin removes all client work after an automatic backup, to load every
// client again in one go
export function FreshStart({ onDone }: { onDone?: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [backupsReady, setBackupsReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [clearFiles, setClearFiles] = useState(false);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    axios
      .get<{ counts: Counts; backupsReady: boolean }>("/api/admin/fresh-start")
      .then((response) => {
        setCounts(response.data.counts);
        setBackupsReady(response.data.backupsReady);
      })
      .catch((error) => toast.error(apiErrorMessage(error, "Could not load the data counts")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    setOpen(false);
    setPassword("");
    setTyped("");
  };

  const run = async () => {
    setRunning(true);
    try {
      const response = await axios.post<{ files: { cloudinary: number | string; r2: number | string } | null }>(
        "/api/admin/fresh-start",
        { password, clearFiles }
      );
      const files = response.data.files;
      toast.success("Fresh start done. A backup was taken first. You can now import your clients.");
      for (const [where, result] of Object.entries(files ?? {})) {
        if (typeof result === "string") toast.error(`${where === "r2" ? "Compliance files" : "Task files"}: ${result}`);
      }
      close();
      load();
      onDone?.();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setRunning(false);
    }
  };

  const n = (value: number | undefined) => (value === undefined ? "" : ` (${value})`);

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5" /> Fresh start
        </CardTitle>
        <CardDescription>
          Removes all client work so every client can be added again at once (Clients → Import). A backup is taken
          automatically first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-medium">Removed</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>Clients{n(counts?.clients)} with their logins{n(counts?.credentials)}, history and dispatches</li>
              <li>
                Compliance periods{n(counts?.complianceItems)}, files{n(counts?.complianceDocuments)}, works started
                for clients, reminders, notes and GST working sign-offs
              </li>
              <li>Tasks{n(counts?.tasks)} with comments and attachments</li>
              <li>Bills{n(counts?.bills)}, bill history, change requests and Tally exports</li>
              <li>Notifications{n(counts?.notifications)} and the activity log{n(counts?.activities)}</li>
              <li>Bill numbers: every series starts again at 1</li>
            </ul>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Kept</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>Admin, partners and staff: logins, roles, permissions, photos and phone notifications</li>
              <li>Compliance work types, teams, reminder texts and settings</li>
              <li>Company profiles, bill email settings, connectors and client request types</li>
              <li>Number series settings: set the first number in Billing → Number series if it shouldn&apos;t be 1</li>
            </ul>
          </div>
        </div>

        <label className="flex items-start gap-2">
          <Checkbox checked={clearFiles} onCheckedChange={(c) => setClearFiles(c === true)} className="mt-0.5" />
          <span>
            <span className="font-medium">Also delete stored files</span>
            <span className="block text-muted-foreground">
              Task attachments in Cloudinary and compliance files in Cloudflare R2, to free the space. Staff photos are
              kept. Backups don&apos;t include files, so these can&apos;t be brought back.
            </span>
          </span>
        </label>

        {!backupsReady && counts && (
          <p className="text-amber-700 dark:text-amber-400">Set up backups above first: a fresh start always takes one.</p>
        )}
        <Button variant="destructive" disabled={!backupsReady} onClick={() => setOpen(true)}>
          Fresh start…
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(value) => !value && !running && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-destructive" />
              Remove all client data?
            </DialogTitle>
            <DialogDescription>
              {counts && `${counts.clients} clients, ${counts.tasks} tasks and ${counts.bills} bills will be removed. `}
              {clearFiles ? "Stored files will be deleted too. " : "Stored files are kept. "}A backup is taken first.
            </DialogDescription>
          </DialogHeader>
          <form
            id="fresh-start-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (password && typed === CONFIRM_WORD) run();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="fresh-start-word">
                Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
              </Label>
              <Input id="fresh-start-word" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fresh-start-password">Your login password</Label>
              <Input
                id="fresh-start-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={running}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="fresh-start-form"
              variant="destructive"
              disabled={!password || typed !== CONFIRM_WORD || running}
            >
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {running ? "Taking backup and removing…" : "Remove all client data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

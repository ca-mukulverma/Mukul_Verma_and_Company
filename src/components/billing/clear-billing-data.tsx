"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "./bill-types";

interface Counts {
  bills: number;
  approvedBills: number;
  events: number;
  changeRequests: number;
  tallyExports: number;
  completedTasks: number;
}

// Admin clears all bills for a fresh start, confirmed with the login password
export function ClearBillingData({ onCleared }: { onCleared?: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    axios
      .get<{ counts: Counts }>("/api/billing/reset")
      .then((response) => setCounts(response.data.counts))
      .catch((error) => toast.error(apiErrorMessage(error, "Could not load billing data")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    setOpen(false);
    setPassword("");
  };

  const clear = async () => {
    setClearing(true);
    try {
      const response = await axios.post<{ recreatedDraftBills: number }>("/api/billing/reset", { password });
      const recreated = response.data.recreatedDraftBills;
      toast.success(
        recreated > 0
          ? `Billing data cleared. ${recreated} completed task${recreated === 1 ? " is" : "s are"} back as new draft bills.`
          : "Billing data cleared"
      );
      close();
      load();
      onCleared?.();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setClearing(false);
    }
  };

  return (
    <Card className="max-w-2xl border-destructive/50">
      <CardHeader>
        <CardTitle>Clear billing data</CardTitle>
        <CardDescription>
          Removes every bill so billing can start afresh, e.g. after testing. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <p className="font-medium">Removed</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>
              All MVC and B Edge bills at every stage{counts && ` (${counts.bills}, of which ${counts.approvedBills} numbered)`}
              : drafts, awaiting amount, awaiting approval, the Billing List, cancelled and not billable
            </li>
            <li>Each bill&apos;s history{counts && ` (${counts.events} entries)`} and email delivery status</li>
            <li>Edit, cancel and reissue requests{counts && ` (${counts.changeRequests})`}</li>
            <li>Tally export history{counts && ` (${counts.tallyExports})`}</li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium">Kept</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>Number series, company profiles, Tally ledgers and bill email settings</li>
            <li>Users and their billing permissions, clients, tasks and client history</li>
            <li>
              Completed tasks still waiting for billing{counts && ` (${counts.completedTasks})`} come back as new
              draft bills
            </li>
          </ul>
        </div>
        <p className="text-muted-foreground">
          The number series are not changed. Set the next numbers in <span className="font-medium">Number series</span>{" "}
          afterwards if needed.
        </p>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Clear billing data
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(value) => !value && !clearing && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-destructive" />
              Clear all billing data?
            </DialogTitle>
            <DialogDescription>
              {counts ? `${counts.bills} bill${counts.bills === 1 ? "" : "s"} will be deleted permanently. ` : ""}
              Enter your login password to confirm.
            </DialogDescription>
          </DialogHeader>
          <form
            id="clear-billing-form"
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) clear();
            }}
          >
            <Label htmlFor="clear-billing-password">Password</Label>
            <Input
              id="clear-billing-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={clearing}>
              Cancel
            </Button>
            <Button type="submit" form="clear-billing-form" variant="destructive" disabled={!password || clearing}>
              {clearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Clear billing data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

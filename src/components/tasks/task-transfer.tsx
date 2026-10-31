"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { blobErrorMessage, downloadBillFile } from "@/components/billing/bill-types";

interface Problem {
  row: number;
  title: string | null;
  errors: string[];
  warnings: string[];
  duplicate: string | null;
}

interface Preview {
  summary: { total: number; ready: number; errors: number; duplicates: number; warnings: number };
  problems: Problem[];
}

function errorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === "string") return error.response.data.error;
  return fallback;
}

// Admin and partners download the tasks to Excel
export function TaskExportButton() {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await downloadBillFile({ method: "get", url: "/api/tasks/export" });
    } catch (error) {
      toast.error(await blobErrorMessage(error, "Could not export the tasks"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" onClick={download} disabled={busy} className="w-full sm:w-auto">
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      Export tasks
    </Button>
  );
}

// Adds tasks again from a file made by Export tasks
export function TaskImportDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allPending, setAllPending] = useState(true);
  const [clearDueDates, setClearDueDates] = useState(false);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (input.current) input.current.value = "";
  };

  const send = (chosen: File, mode: "preview" | "import", options = { allPending, clearDueDates }) => {
    const form = new FormData();
    form.append("file", chosen);
    form.append("mode", mode);
    form.append("allPending", String(options.allPending));
    form.append("clearDueDates", String(options.clearDueDates));
    return axios.post("/api/tasks/import", form);
  };

  const check = async (chosen: File, options = { allPending, clearDueDates }) => {
    setFile(chosen);
    setPreview(null);
    setBusy("check");
    try {
      const response = await send(chosen, "preview", options);
      setPreview(response.data);
    } catch (error) {
      toast.error(errorMessage(error, "Could not read the file"));
      reset();
    } finally {
      setBusy(null);
    }
  };

  // The options change what is checked (due dates), so check the file again
  const changeOption = (next: { allPending: boolean; clearDueDates: boolean }) => {
    setAllPending(next.allPending);
    setClearDueDates(next.clearDueDates);
    if (file) check(file, next);
  };

  const runImport = async () => {
    if (!file) return;
    setBusy("import");
    try {
      const response = await send(file, "import");
      toast.success(`${response.data.created} task${response.data.created === 1 ? "" : "s"} added`);
      onImported?.();
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(errorMessage(error, "Import failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Import tasks
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import tasks from Excel</DialogTitle>
          <DialogDescription>
            Upload a file made by Export tasks to add the tasks again as new tasks. Every row is checked before anything is
            saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={allPending}
                onCheckedChange={(v) => changeOption({ allPending: v === true, clearDueDates })}
                disabled={busy !== null}
              />
              Start every task as Pending
            </label>
            <p className="pl-6 text-xs text-muted-foreground">
              Untick to keep In progress and Review from the file. Completed and Cancelled tasks are always added as Pending.
            </p>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={clearDueDates}
                onCheckedChange={(v) => changeOption({ allPending, clearDueDates: v === true })}
                disabled={busy !== null}
              />
              Leave due dates empty
            </label>
          </div>

          <div className="space-y-2">
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) check(chosen);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy !== null}>
              {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {file ? "Choose another file" : "Choose file"}
            </Button>
            {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
          </div>
        </div>

        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-md border border-green-300 bg-green-50 p-2 dark:border-green-900 dark:bg-green-950/40">
                <p className="text-xl font-semibold">{preview.summary.ready}</p>
                <p className="text-xs">Ready to add</p>
              </div>
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
                <p className="text-xl font-semibold">{preview.summary.duplicates}</p>
                <p className="text-xs">Already exist (skipped)</p>
              </div>
              <div className="rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/40">
                <p className="text-xl font-semibold">{preview.summary.errors}</p>
                <p className="text-xs">Need fixing (skipped)</p>
              </div>
            </div>

            {preview.problems.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Row</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.problems.map((p) => (
                      <TableRow key={p.row}>
                        <TableCell>{p.row}</TableCell>
                        <TableCell>{p.title || "—"}</TableCell>
                        <TableCell
                          className={
                            p.errors.length
                              ? "text-red-700 dark:text-red-400"
                              : p.duplicate
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                          }
                        >
                          {p.errors.length ? p.errors.join("; ") : p.duplicate ?? `Will be added. ${p.warnings.join("; ")}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />All {preview.summary.total} rows are ready.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Tasks are added as created by you. No notifications are sent to the staff for imported tasks.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={runImport} disabled={!preview || preview.summary.ready === 0 || busy !== null}>
            {busy === "import" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {preview?.summary.ready ?? 0} task{preview?.summary.ready === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

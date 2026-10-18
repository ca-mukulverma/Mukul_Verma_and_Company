"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface PreviewRow {
  row: number;
  data: { contactPerson: string | null; companyName: string | null; email: string | null; phone: string | null };
  errors: string[];
  duplicate: string | null;
}

interface Preview {
  summary: { total: number; ready: number; errors: number; duplicates: number };
  rows: PreviewRow[];
}

function errorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === "string") return error.response.data.error;
  return fallback;
}

// Admin adds many clients at once from the Excel template
export function ClientImportDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"template" | "check" | "import" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (input.current) input.current.value = "";
  };

  const downloadTemplate = async () => {
    setBusy("template");
    try {
      const response = await axios.get<Blob>("/api/clients/import", { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Client-import-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Could not download the template");
    } finally {
      setBusy(null);
    }
  };

  const send = async (chosen: File, mode: "preview" | "import") => {
    const form = new FormData();
    form.append("file", chosen);
    form.append("mode", mode);
    return axios.post(`/api/clients/import`, form);
  };

  const check = async (chosen: File) => {
    setFile(chosen);
    setPreview(null);
    setBusy("check");
    try {
      const response = await send(chosen, "preview");
      setPreview(response.data);
    } catch (error) {
      toast.error(errorMessage(error, "Could not read the file"));
      reset();
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy("import");
    try {
      const response = await send(file, "import");
      toast.success(`${response.data.created} client${response.data.created === 1 ? "" : "s"} added`);
      onImported?.();
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(errorMessage(error, "Import failed"));
    } finally {
      setBusy(null);
    }
  };

  const problems = preview?.rows.filter((r) => r.errors.length > 0 || r.duplicate) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="flex-1">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          <span className="hidden xs:inline">Import from Excel</span>
          <span className="xs:hidden">Import</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import clients from Excel</DialogTitle>
          <DialogDescription>Add many permanent clients at once. Every row is checked before anything is saved.</DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 text-sm">
          <li className="space-y-2">
            <p className="font-medium">1. Download the template and fill one client per row</p>
            <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={busy !== null}>
              {busy === "template" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download template (.xlsx)
            </Button>
            <p className="text-xs text-muted-foreground">
              Contact Person is required, plus Email or Phone. The Instructions sheet in the file explains every column.
            </p>
          </li>
          <li className="space-y-2">
            <p className="font-medium">2. Upload the filled file</p>
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
          </li>
        </ol>

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

            {problems.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Row</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Problem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {problems.map((r) => (
                      <TableRow key={r.row}>
                        <TableCell>{r.row}</TableCell>
                        <TableCell>{r.data.companyName || r.data.contactPerson || "—"}</TableCell>
                        <TableCell className={r.errors.length ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>
                          {r.errors.length ? r.errors.join("; ") : r.duplicate}
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
            {preview.summary.errors > 0 && (
              <p className="text-xs text-muted-foreground">
                You can import the ready rows now, then fix the others in the file and upload it again; rows already added are
                recognised and skipped.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={runImport} disabled={!preview || preview.summary.ready === 0 || busy !== null}>
            {busy === "import" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {preview?.summary.ready ?? 0} client{preview?.summary.ready === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

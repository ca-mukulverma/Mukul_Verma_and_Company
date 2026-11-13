"use client";

import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { apiErrorMessage, blobErrorMessage, downloadBillFile } from "./bill-types";

interface Row {
  row: number;
  client: string | null;
  from: string | null;
  to: string | null;
  status: "change" | "confirm" | "error";
  errors: string[];
  warnings: string[];
}

interface Preview {
  summary: { total: number; change: number; confirm: number; same: number; error: number; warnings: number };
  rows: Row[];
}

const FILE_URL = "/api/billing/tally/ledgers/file";
const ORDER = { error: 0, change: 1, confirm: 2 } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Billing managers set every client's Tally ledger at once: download the
// list, fill in the names in Excel, upload, check and save
export function TallyLedgerFile({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmUnchanged, setConfirmUnchanged] = useState(false);
  const [busy, setBusy] = useState<"download" | "check" | "save" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setConfirmUnchanged(false);
    if (input.current) input.current.value = "";
  };

  const download = async () => {
    setBusy("download");
    try {
      await downloadBillFile({ method: "get", url: FILE_URL });
    } catch (error) {
      toast.error(await blobErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const send = (chosen: File, mode: "preview" | "save") => {
    const form = new FormData();
    form.append("file", chosen);
    form.append("mode", mode);
    if (mode === "save" && confirmUnchanged) form.append("confirmUnchanged", "true");
    return axios.post(FILE_URL, form);
  };

  const check = async (chosen: File) => {
    setFile(chosen);
    setPreview(null);
    setConfirmUnchanged(false);
    setBusy("check");
    try {
      setPreview((await send(chosen, "preview")).data);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not read the file"));
      reset();
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!file) return;
    setBusy("save");
    try {
      const { changed, confirmed } = (await send(file, "save")).data as { changed: number; confirmed: number };
      toast.success(
        [changed && `${plural(changed, "ledger")} saved`, confirmed && `${confirmed} confirmed`].filter(Boolean).join(", ") ||
          "Nothing to change"
      );
      onSaved();
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not save the ledgers"));
    } finally {
      setBusy(null);
    }
  };

  const s = preview?.summary;
  const toSave = (s?.change ?? 0) + (confirmUnchanged ? s?.confirm ?? 0 : 0);
  const rows = preview ? [...preview.rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.row - b.row) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Ledger names from Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Client ledgers in one go</DialogTitle>
          <DialogDescription>
            Download every client with the ledger used now, change the yellow <strong>Tally Ledger Name</strong> column to
            the names exactly as they are in Tally, and upload the file. You see every change before it is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={download} disabled={busy !== null}>
            {busy === "download" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            1. Download client list
          </Button>
          <Button variant="outline" onClick={() => input.current?.click()} disabled={busy !== null}>
            {busy === "check" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            2. Upload filled file
          </Button>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) check(chosen);
            }}
          />
          {file && <span className="self-center text-sm text-muted-foreground truncate">{file.name}</span>}
        </div>

        {s && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge>{plural(s.change, "change")}</Badge>
              {s.confirm > 0 && <Badge variant="secondary">{s.confirm} to be set, unchanged</Badge>}
              <Badge variant="outline">{s.same} unchanged</Badge>
              {s.error > 0 && <Badge variant="destructive">{plural(s.error, "row")} with problems (skipped)</Badge>}
              {s.warnings > 0 && <Badge variant="outline" className="border-amber-500 text-amber-700">{plural(s.warnings, "warning")}</Badge>}
            </div>

            {s.confirm > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={confirmUnchanged} onCheckedChange={(v) => setConfirmUnchanged(v === true)} className="mt-0.5" />
                <span>
                  Also mark the {plural(s.confirm, "client")} still <em>to be set</em> but unchanged in the file as checked
                  (their Tally ledger is the client&apos;s name). They then leave the daily reminder.
                </span>
              </label>
            )}

            {rows.length > 0 && (
              <div className="max-h-[45vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Ledger now</TableHead>
                      <TableHead>New ledger</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.row} className={r.status === "error" ? "bg-destructive/5" : undefined}>
                        <TableCell className="text-muted-foreground">{r.row}</TableCell>
                        <TableCell className="min-w-0">
                          {r.client ?? "—"}
                          {r.errors.map((e) => (
                            <p key={e} className="text-xs text-destructive">{e}</p>
                          ))}
                          {r.warnings.map((w) => (
                            <p key={w} className="text-xs text-amber-700">{w}</p>
                          ))}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.from ?? "—"}</TableCell>
                        <TableCell className={r.status === "change" ? "font-medium" : "text-muted-foreground"}>
                          {r.status === "confirm" ? "Unchanged" : r.to ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={!preview || toSave === 0 || busy !== null}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save {preview ? plural(toSave, "client") : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

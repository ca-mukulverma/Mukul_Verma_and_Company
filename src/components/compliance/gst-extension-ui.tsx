"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { compareVersions, DIAG_VERSION, downloadGstExtension, portalDiagnostics } from "./gst-extension";
import { GstGuideButton } from "./gst-guide";

// The GST extension's own controls, shared by the GST portal box, the
// download panel and the download bar: install / update steps, the installed
// version, and its diagnostics.

// The installed extension's version, with an update button when the app
// ships a newer one (or the installed one can't fetch files at all)
export function ExtensionVersion({ installed, latest, needed, busy, onUpdate }: { installed: string; latest: string | null; needed: boolean; busy: boolean; onUpdate: () => void }) {
  const outdated = needed || (!!latest && compareVersions(installed, latest) < 0);
  if (!outdated) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          GST extension {installed}
          {latest && " (latest)"} ·{" "}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onUpdate}>
            reinstall
          </button>
        </span>
        <GstGuideButton variant="ghost" className="h-7 px-2 text-xs" label="Step-by-step guide · English / हिंदी / Hinglish" />
        <DiagnosticsButton installed={installed} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <span>
        {needed
          ? `This computer has GST extension ${installed}, which can't fetch the ticked files.`
          : `This computer has GST extension ${installed}; ${latest} is out, with fixes.`}{" "}
        Update it once on this computer{busy ? " (after this login ends)" : ""}.
      </span>
      <Button size="sm" variant="outline" className="h-7" onClick={onUpdate}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Update the GST extension{latest ? ` to ${latest}` : ""}
      </Button>
      <GstGuideButton variant="ghost" className="h-7 px-2 text-xs" label="Step-by-step guide · English / हिंदी / Hinglish" />
      <DiagnosticsButton installed={installed} />
    </div>
  );
}

// Saves the extension's record of the last GST portal login as a text file
// (and copies it), to send to the admin when the portal refuses a page
export function DiagnosticsButton({ installed }: { installed: string }) {
  const [saving, setSaving] = useState(false);
  if (compareVersions(installed, DIAG_VERSION) < 0) return null;
  const save = async () => {
    setSaving(true);
    try {
      const answer = await portalDiagnostics();
      if (!answer.ok || !answer.text) {
        // An old background.js next to a newer manifest doesn't know the request
        const old = answer.error === "Unknown request" ? "The GST extension on this computer has old files in its folder: reinstall it (delete the mvc-gst folder's files first), then reload this page" : null;
        toast.error(old ?? answer.error ?? "The GST extension gave no diagnostics: update it and reload this page");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const url = URL.createObjectURL(new Blob([answer.text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gst-diagnostics-${stamp}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const copied = await navigator.clipboard?.writeText(answer.text).then(
        () => true,
        () => false
      );
      toast.success(`Diagnostics saved to Downloads${copied ? " and copied" : ""}: send the file to the admin`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={save} title="The extension's record of the last GST portal login, for the admin">
      {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />} Save diagnostics
    </Button>
  );
}

export function InstallDialog({ onClose, update = null, latest = null }: { onClose: () => void; update?: string | null; latest?: string | null }) {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadGstExtension();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download the extension");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{update ? "Update the GST extension" : "Install the GST extension"}</DialogTitle>
          <DialogDescription>
            {update
              ? `This computer has ${update}${latest ? `; the new one is ${latest}` : ""}. Nothing is lost: the extension keeps no data.`
              : "Once on each computer, in Chrome or Edge. It only works on the GST portal and on this app."}
          </DialogDescription>
        </DialogHeader>
        {update ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
                {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} Download the new extension
              </Button>
            </li>
            <li>
              Open your <span className="font-mono">mvc-gst</span> folder and delete everything inside it (keep the empty folder).
            </li>
            <li>
              Right-click the ZIP → <span className="font-medium">Extract all</span>, and as the folder choose the one that <span className="font-medium">holds</span>{" "}
              <span className="font-mono">mvc-gst</span> (for example Documents), not <span className="font-mono">mvc-gst</span> itself. Choose{" "}
              <span className="font-medium">Replace the files</span> if asked. The five files must sit directly in <span className="font-mono">mvc-gst</span>.
            </li>
            <li>
              Open <span className="font-mono">chrome://extensions</span> (Edge: <span className="font-mono">edge://extensions</span>) and click the{" "}
              <span className="font-medium">reload arrow</span> on <span className="font-medium">MV Company GST portal</span>. Allow any new permission it asks for.
            </li>
            <li>Check it shows version {latest ?? "the new number"}, then reload this page.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
                {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} Download the extension
              </Button>{" "}
              and unzip it (right-click → Extract all). Keep the <span className="font-mono">mvc-gst</span> folder where it won&apos;t be deleted.
            </li>
            <li>
              Open <span className="font-mono">chrome://extensions</span> (Edge: <span className="font-mono">edge://extensions</span>) in the address bar.
            </li>
            <li>Turn on <span className="font-medium">Developer mode</span>.</li>
            <li>
              Click <span className="font-medium">Load unpacked</span> and choose the <span className="font-mono">mvc-gst</span> folder.
            </li>
            <li>Reload this page.</li>
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          {update ? (
            <>
              Can&apos;t find the old <span className="font-mono">mvc-gst</span> folder? Click <span className="font-medium">Remove</span> on the extension in the extensions page, unzip
              the new one anywhere permanent, then <span className="font-medium">Load unpacked</span> that folder (Developer mode on).
            </>
          ) : (
            <>To update it later, use Update the GST extension in this box.</>
          )}
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <GstGuideButton label="Full guide · English / हिंदी / Hinglish" />
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

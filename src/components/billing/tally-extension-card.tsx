"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadTallyExtension, extensionCanSync, SYNC_EXTENSION_VERSION, tallyExtensionVersion } from "./tally-extension";

// The MV Company Tally extension for a Tally PC, downloadable by every manager
// from their own login (Billing → Tally, Debtors): it sends bills into
// TallyPrime and the debtors and sales from Tally to the app. Connecting a
// Tally PC for Debtors stays with Admin.
export function TallyExtensionCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The bridge marks the page as soon as it loads; look again in a moment
  useEffect(() => {
    setVersion(tallyExtensionVersion());
    const t = setTimeout(() => setVersion(tallyExtensionVersion()), 800);
    return () => clearTimeout(t);
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      await downloadTallyExtension();
    } catch {
      toast.error("Could not download the extension");
    } finally {
      setBusy(false);
    }
  };

  const current = extensionCanSync(version);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Puzzle className="h-4 w-4" /> MV Company Tally extension
        </CardTitle>
        <CardDescription>
          For the Chrome on the PC where TallyPrime runs. Latest version: {SYNC_EXTENSION_VERSION}. On this computer:{" "}
          {version ? `version ${version}${current ? " (up to date)" : " – please update"}` : "not installed"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Button variant={current ? "outline" : "default"} size="sm" onClick={download} disabled={busy}>
          <Download className="mr-1 h-4 w-4" /> Download the Tally extension
        </Button>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Unzip the file into a folder that stays, e.g. C:\MVC (it holds an <code>mvc-tally</code> folder).</li>
          <li>
            <b>First time:</b> Chrome → <code>chrome://extensions</code> → turn on Developer mode → Load unpacked → choose the{" "}
            <code>mvc-tally</code> folder.
          </li>
          <li>
            <b>Updating:</b> copy the new files over the old <code>mvc-tally</code> folder (Replace), then press the reload button on
            &quot;MV Company Tally&quot; in <code>chrome://extensions</code>. Don&apos;t remove it and load it again: that loses the PC&apos;s
            connection for Debtors.
          </li>
          <li>Reload this page. Connecting a Tally PC for Debtors is done by Admin, on that PC.</li>
        </ol>
      </CardContent>
    </Card>
  );
}

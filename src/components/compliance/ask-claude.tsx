"use client";

import { toast } from "sonner";
import { Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

// Opens the user's own Claude app (claude.ai, on their Pro plan) with a ready
// question. Nothing is sent to Claude from this app and it costs nothing
// extra: the question runs in the user's subscription, and Claude reads the
// data through the read-only database connection set up in Claude's settings
// (see docs/COMPLIANCE.md).

const DATA_NOTE =
  "Use my Neon database connector, read-only (only SELECT queries; never change any data). " +
  'The tables are "ComplianceItem" (one row per client, work and period; status, filedAt, arn, isNil, taxPayable, and a JSON "figures" column: ' +
  "GSTR-1 taxable, tax, taxable1A, tax1A; GSTR-3B taxable, outputTax, itcClaimed, itc2b, rcmTax, cashPaid; TDS returns deducted, deposited, deductees, challans), " +
  '"ComplianceWorkType" (name, kind), "ComplianceObligationLine" with "ClientObligation" (RCM/TDS lines and their status), "TdsChallan", and "Client" (contactPerson, companyName, gstin). ' +
  "Show the answer as clear tables with totals, then a short list of anything that needs attention.";

export function askClaudeUrl(question: string) {
  return `https://claude.ai/new?q=${encodeURIComponent(`${question}\n\n${DATA_NOTE}`)}`;
}

export function AskClaudeButton({ question, label = "Ask Claude" }: { question: string; label?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${question}\n\n${DATA_NOTE}`);
      toast.success("Question copied. Paste it in Claude");
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div className="inline-flex">
      <Button size="sm" variant="outline" className="rounded-r-none" asChild>
        <a href={askClaudeUrl(question)} target="_blank" rel="noreferrer" title="Opens your Claude app with this question (uses your Claude plan, no extra cost)">
          <Sparkles className="mr-1 h-4 w-4" /> {label}
        </a>
      </Button>
      <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-2" onClick={copy} title="Copy the question">
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LedgerView } from "@/components/debtors/ledger-view";

// One debtor's ledger from Tally (docs/TALLY_DEBTORS.md)
export default function DebtorLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/debtors">
          <ArrowLeft className="mr-1 h-4 w-4" /> Debtors
        </Link>
      </Button>
      <LedgerView ledgerId={id} />
    </div>
  );
}

"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LedgerView } from "@/components/debtors/ledger-view";

// One debtor's ledger from Tally (docs/TALLY_DEBTORS.md). ?send=whatsapp opens
// the WhatsApp step (from Recovery's list of whom to chase).
export default function DebtorLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Ledger id={id} />
    </Suspense>
  );
}

function Ledger({ id }: { id: string }) {
  const search = useSearchParams();
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/debtors">
          <ArrowLeft className="mr-1 h-4 w-4" /> Debtors
        </Link>
      </Button>
      <LedgerView ledgerId={id} openWhatsApp={search.get("send") === "whatsapp"} />
    </div>
  );
}

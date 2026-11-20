"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { LedgerView } from "@/components/debtors/ledger-view";

interface ClientLedger {
  ledgerName: string;
  linked: boolean;
  ledger: { id: string; name: string } | null;
  connector: { name: string; ledger: { id: string; name: string } | null } | null;
}

// The client's Sundry Debtors ledger from Tally, on the client's page (Admin
// and the partners allowed to see Debtors). docs/TALLY_DEBTORS.md
export function ClientLedgerTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientLedger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<ClientLedger>(`/api/clients/${clientId}/ledger`)
      .then(({ data }) => !cancelled && setData(data))
      .catch((e) => !cancelled && setError(apiError(e, "Could not load the ledger")));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-64 w-full" />;

  const connectorNote = data.connector && (
    <p className="text-sm text-muted-foreground">
      This client&apos;s bills go to the connector {data.connector.name}&apos;s ledger, which also holds other clients&apos; bills.{" "}
      {data.connector.ledger ? (
        <Link href={`/dashboard/debtors/${data.connector.ledger.id}`} className="text-primary underline-offset-2 hover:underline">
          Open {data.connector.ledger.name}
        </Link>
      ) : (
        "That ledger is not in the Tally data."
      )}
    </p>
  );

  if (!data.ledger) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <p>
            No Sundry Debtors ledger named <b>{data.ledgerName}</b> is in the Tally data.
            {data.linked ? "" : " No Tally ledger is linked to this client, so its name was looked for."} Link the client&apos;s Tally
            ledger in Billing → Tally if it has another name in Tally.
          </p>
          {connectorNote}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {connectorNote}
      <LedgerView ledgerId={data.ledger.id} showParty={false} />
    </div>
  );
}

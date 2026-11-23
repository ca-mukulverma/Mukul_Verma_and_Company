"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { LedgerView } from "@/components/debtors/ledger-view";
import { ENTITY_LABELS, type DebtorEntity } from "@/lib/tally-debtors-shared";

interface Found {
  id: string;
  name: string;
  entity: DebtorEntity;
}

interface ClientLedger {
  ledgerName: string;
  linked: boolean;
  ledgers: Found[];
  connector: { name: string; ledgers: Found[] } | null;
}

// The client's Sundry Debtors ledgers from Tally on the client's page: MVC's
// and B Edge's separately, each with its own PDF / Excel / WhatsApp / Email (Admin and
// the partners allowed to see Debtors). docs/TALLY_DEBTORS.md
export function ClientLedgerTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

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
      {data.connector.ledgers.length
        ? data.connector.ledgers.map((l) => (
            <Link key={l.id} href={`/dashboard/debtors/${l.id}`} className="mr-3 text-primary underline-offset-2 hover:underline">
              Open {l.name} ({ENTITY_LABELS[l.entity]})
            </Link>
          ))
        : "That ledger is not in the Tally data."}
    </p>
  );

  if (!data.ledgers.length) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <p>
            No Sundry Debtors ledger named <b>{data.ledgerName}</b> is in MVC&apos;s or B Edge&apos;s Tally data.
            {data.linked ? "" : " No Tally ledger is linked to this client, so its name was looked for."} Link the client&apos;s Tally
            ledger in Billing → Tally if it has another name in Tally.
          </p>
          {connectorNote}
        </CardContent>
      </Card>
    );
  }
  const current = data.ledgers.find((l) => l.id === chosen) ?? data.ledgers[0];
  return (
    <div className="space-y-3">
      {connectorNote}
      {data.ledgers.length > 1 && (
        <div className="flex items-center gap-1 rounded-lg border p-1 w-fit" role="tablist" aria-label="Firm">
          {data.ledgers.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={current.id === l.id}
              onClick={() => setChosen(l.id)}
              className={
                current.id === l.id
                  ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
              }
            >
              {ENTITY_LABELS[l.entity]} ledger
            </button>
          ))}
        </div>
      )}
      <LedgerView key={current.id} ledgerId={current.id} showParty={false} />
    </div>
  );
}

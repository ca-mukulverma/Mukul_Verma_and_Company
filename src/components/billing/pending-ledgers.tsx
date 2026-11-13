"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LedgerPicker } from "@/components/clients/ledger-picker";
import { useBillingOptions } from "@/components/clients/client-extra-fields";
import { apiErrorMessage } from "./bill-types";

interface PendingClient {
  id: string;
  name: string;
  contactPerson: string;
  gstin: string | null;
  createdAt: string;
  addedBy: string;
}

// New clients added without a Tally ledger: the billing manager creates the
// ledger in Tally (or picks one already there) and ticks the client off
export function PendingLedgers({ onSaved }: { onSaved: () => void }) {
  const [clients, setClients] = useState<PendingClient[] | null>(null);
  const options = useBillingOptions();

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<{ clients: PendingClient[] }>("/api/billing/tally/ledgers");
      setClients(data.clients);
    } catch {
      setClients([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!clients || clients.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          New clients without a Tally ledger <Badge variant="secondary">{clients.length}</Badge>
        </CardTitle>
        <CardDescription>
          Create each ledger in Tally, or pick a ledger already there, then press <strong>Done</strong>. Left as
          &quot;Client&apos;s name&quot;, the ledger in Tally must be named exactly as the client.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {clients.map((client) => (
          <PendingRow
            key={client.id}
            client={client}
            options={options}
            onDone={() => {
              setClients((list) => list?.filter((c) => c.id !== client.id) ?? null);
              onSaved();
            }}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PendingRow({
  client,
  options,
  onDone,
}: {
  client: PendingClient;
  options: ReturnType<typeof useBillingOptions>;
  onDone: () => void;
}) {
  const [ledger, setLedger] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      // Empty, or the client's own name: the ledger is the client's name
      const name = ledger.trim() === client.name ? "" : ledger.trim();
      await axios.put("/api/billing/tally/ledgers", { clientId: client.id, tallyLedgerName: name });
      toast.success(`${client.name}: ledger set`);
      onDone();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[1fr_minmax(14rem,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{client.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {client.name !== client.contactPerson && `${client.contactPerson} · `}
          {client.gstin && `${client.gstin} · `}
          Added by {client.addedBy} on {format(new Date(client.createdAt), "d MMM yyyy")}
        </p>
      </div>
      <LedgerPicker value={ledger} onChange={setLedger} ledgers={options?.ledgers ?? []} clientName={client.name} />
      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
        Done
      </Button>
    </div>
  );
}

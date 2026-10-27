import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";

// Connectors bring clients to the firm and pay their fees, so a connector
// client's bills go to the connector's ledger in Tally (see docs/BILLING.md).
// The bill is still made out to the client; its GSTIN is printed, and the
// bill reported as B2B, only when the bill's "Show GSTIN" is ticked.

// Only billing managers and Admin set Tally ledger names
export async function canSetTallyLedger(userId: string) {
  const access = await getBillingAccess(userId);
  return !!access && (access.isAdmin || access.manages.length > 0);
}

export function connectorLedger(connector: { name: string; tallyLedgerName: string | null }) {
  return connector.tallyLedgerName || connector.name;
}

export interface LedgerClient {
  contactPerson: string;
  companyName: string | null;
  tallyLedgerName: string | null;
  connector: { id: string; name: string; tallyLedgerName: string | null } | null;
}

// The party ledger a client's bills go to now: the connector's, else the
// client's own Tally name, else the client's name
export function clientLedger(client: LedgerClient) {
  if (client.connector) return connectorLedger(client.connector);
  return client.tallyLedgerName || client.companyName || client.contactPerson;
}

export const ledgerClientSelect = {
  contactPerson: true,
  companyName: true,
  tallyLedgerName: true,
  connector: { select: { id: true, name: true, tallyLedgerName: true } },
} as const;

// Whether a bill shows (and reports) the client's GSTIN: always for a client
// without a connector; for a connector's client only when ticked on the bill
export function billShowsGstin(bill: { showGstin: boolean; connectorId: string | null; billNumber?: string | null }, clientConnectorId: string | null) {
  // A numbered bill keeps the connector it had at approval
  const connectorId = bill.billNumber ? bill.connectorId : clientConnectorId;
  return !connectorId || bill.showGstin;
}

// The ledger and connector fixed on bills at final approval
export async function ledgersAtApproval(billIds: string[]) {
  const bills = await prisma.bill.findMany({
    where: { id: { in: billIds } },
    select: { id: true, billToName: true, client: { select: ledgerClientSelect } },
  });
  return new Map(
    bills.map((b) => [
      b.id,
      {
        tallyLedgerName: b.client ? clientLedger(b.client) : b.billToName || null,
        connectorId: b.client?.connector?.id ?? null,
      },
    ])
  );
}

export const connectorSchema = z.object({
  name: z.string().trim().min(2, "Enter the connector's name").max(100),
  phone: z.string().trim().max(15).optional().nullable(),
  email: z.string().trim().email("Invalid email").max(75).optional().nullable().or(z.literal("")),
  tallyLedgerName: z.string().trim().max(100).optional().nullable(),
});

// Billing managers and Admin look after connectors (Billing → Connectors)
export async function connectorAccess() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await getBillingAccess(user.id);
  if (!access || (!access.isAdmin && access.manages.length === 0)) {
    return { error: NextResponse.json({ error: "Only the billing manager or Admin can do this" }, { status: 403 }) };
  }
  return { access };
}

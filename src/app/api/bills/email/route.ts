import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import {
  BILLING_EMAIL_ADDRESS,
  billingEmailConfigured,
  getBillEmailSettings,
  loadBillEmailGroups,
  parseEmailList,
  sendBillEmails,
} from "@/lib/bill-email";

// Emails are sent one after another within the request, so the number of
// bills at once is kept well inside the time a request may take
const MAX_BILLS = 30;

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview"), ids: z.array(z.string().min(1)).min(1).max(MAX_BILLS) }),
  z.object({
    mode: z.literal("send"),
    ids: z.array(z.string().min(1)).min(1).max(MAX_BILLS),
    // Party key → "a@b.com, c@d.com"
    recipients: z.record(z.string().max(400)),
    // Parties whose address should also be saved on the client
    saveToClient: z.array(z.string()).max(MAX_BILLS).default([]),
    note: z.string().trim().max(2000).optional().nullable(),
  }),
]);

// POST /api/bills/email – email approved bills to their parties: one email per
// party with its bills attached. Billing managers, Admin and partners allowed
// to see the Billing List.
//   preview – who would get which bills, with the saved addresses
//   send    – send them to the addresses given
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access || access.listCompanies.length === 0) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: `Select up to ${MAX_BILLS} bills to email at a time` }, { status: 400 });
  }
  const input = parsed.data;
  const ids = [...new Set(input.ids)];
  const groups = await loadBillEmailGroups(ids, access);
  const billCount = groups.reduce((sum, g) => sum + g.docs.length, 0);

  if (input.mode === "preview") {
    const settings = await getBillEmailSettings();
    return NextResponse.json({
      configured: billingEmailConfigured(),
      sender: BILLING_EMAIL_ADDRESS,
      allowReplies: settings.allowReplies,
      // Cancelled bills, and bills not found, are not emailed
      skipped: ids.length - billCount,
      groups: groups.map((g) => ({
        key: g.key,
        partyName: g.partyName,
        savedEmail: g.savedEmail,
        isClient: !!g.clientId,
        bills: g.docs.map((d) => ({ id: d.id, billNumber: d.billNumber, total: d.total })),
      })),
    });
  }

  if (!billingEmailConfigured()) {
    return NextResponse.json(
      { error: "Bill emails are not set up yet: the billing mailbox password (BILLING_EMAIL_PASSWORD) is missing" },
      { status: 503 }
    );
  }
  if (groups.length === 0) {
    return NextResponse.json({ error: "None of the selected bills can be emailed (only approved bills can)" }, { status: 400 });
  }

  const sends: { group: (typeof groups)[number]; to: string[] }[] = [];
  for (const group of groups) {
    const to = parseEmailList(input.recipients[group.key] ?? "");
    if (!to) {
      return NextResponse.json({ error: `Enter a valid email address for ${group.partyName}` }, { status: 400 });
    }
    sends.push({ group, to });
  }

  const results = await sendBillEmails(sends, { note: input.note, userId: user.id });

  // Save the address on clients that had none, when asked to
  for (const { group, to } of sends) {
    const sent = results.some((r) => r.key === group.key && r.ok);
    if (sent && group.clientId && !group.savedEmail && input.saveToClient.includes(group.key)) {
      await prisma.client.updateMany({
        where: { id: group.clientId, OR: [{ email: null }, { email: "" }] },
        data: { email: to[0] },
      });
    }
  }

  return NextResponse.json({ results });
}

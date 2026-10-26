import { NextRequest, NextResponse } from "next/server";
import { Company } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, partyName, renderMessage, whatsappNumber } from "@/lib/compliance";
import { periodLabel } from "@/lib/compliance-periods";
import { emailsSentToday, firmName, GMAIL_DAILY_LIMIT, sendComplianceEmails } from "@/lib/compliance-email";
import { parseEmailList } from "@/lib/bill-email";
import { badRequest, forbidden, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(1000),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  // Changed text from the dialog; {client} etc. are still filled in per client
  message: z.string().trim().max(2000).optional().nullable(),
});

// POST /api/compliance/reminders – one reminder per client, covering all of
// its selected items. WhatsApp: returns the links to open (counted as sent).
// Email: sends from the company's Gmail.
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { itemIds, channel, message } = body.data;

  const items = await prisma.complianceItem.findMany({
    where: { id: { in: itemIds }, historical: false },
    include: {
      workType: true,
      client: { select: { id: true, contactPerson: true, companyName: true, phone: true, email: true } },
    },
    orderBy: [{ dueDate: "asc" }],
  });
  if (items.some((item) => !canWorkOn(access, item.workTypeId))) return forbidden();
  if (items.length === 0) return badRequest("Nothing to remind about");

  // One reminder per client
  const groups = new Map<string, typeof items>();
  for (const item of items) groups.set(item.clientId, [...(groups.get(item.clientId) ?? []), item]);

  const reminders = [...groups.values()].map((group) => {
    const first = group[0];
    const company: Company = first.workType.company;
    const taxes = group.map((i) => (i.taxPayable === null ? 0 : Number(i.taxPayable)));
    const values = {
      client: partyName(first.client),
      work: [...new Set(group.map((i) => i.workType.name))].join(" & "),
      period: [...new Set(group.map((i) => periodLabel(i.frequency, i.periodStart)))].join(", "),
      due: first.dueDate,
      taxPayable: taxes.reduce((a, b) => a + b, 0) || null,
      firm: firmName(company),
    };
    return {
      group,
      company,
      client: first.client,
      text: renderMessage(message || first.workType.reminderMessage, values),
      subject: renderMessage(first.workType.reminderSubject, values),
    };
  });

  const results: { clientId: string; name: string; ok: boolean; error?: string; phone?: string; text?: string }[] = [];
  const logs: { itemIds: string[]; sentTo: string; ok: boolean; error?: string }[] = [];

  if (channel === "WHATSAPP") {
    for (const r of reminders) {
      const phone = whatsappNumber(r.client.phone);
      const name = partyName(r.client);
      if (!phone) {
        results.push({ clientId: r.client.id, name, ok: false, error: "No valid mobile number on the client" });
        continue;
      }
      results.push({ clientId: r.client.id, name, ok: true, phone, text: r.text });
      logs.push({ itemIds: r.group.map((i) => i.id), sentTo: phone, ok: true });
    }
  } else {
    const sentToday = await emailsSentToday();
    if (sentToday + reminders.length > GMAIL_DAILY_LIMIT) {
      return badRequest(
        `About ${sentToday} emails have gone out today; sending ${reminders.length} more could pass Gmail's daily limit of ${GMAIL_DAILY_LIMIT}. Send fewer now and the rest tomorrow`
      );
    }
    for (const company of ["MVC", "BEDGE"] as Company[]) {
      const batch = reminders.filter((r) => r.company === company);
      const sendable = batch.filter((r) => r.client.email && parseEmailList(r.client.email));
      for (const r of batch.filter((b) => !sendable.includes(b))) {
        results.push({ clientId: r.client.id, name: partyName(r.client), ok: false, error: "No valid email address on the client" });
      }
      if (sendable.length === 0) continue;
      const failures = await sendComplianceEmails(
        company,
        sendable.map((r) => ({ to: parseEmailList(r.client.email!)!, subject: r.subject, text: r.text }))
      );
      sendable.forEach((r, i) => {
        const failure = failures[i];
        results.push({ clientId: r.client.id, name: partyName(r.client), ok: !failure, ...(failure && { error: failure }) });
        logs.push({ itemIds: r.group.map((it) => it.id), sentTo: r.client.email!, ok: !failure, ...(failure && { error: failure }) });
      });
    }
  }

  const now = new Date();
  for (const log of logs) {
    await prisma.complianceReminder.createMany({
      data: log.itemIds.map((itemId) => ({
        itemId,
        channel,
        sentTo: log.sentTo.slice(0, 400),
        ok: log.ok,
        error: log.error ?? null,
        sentById: access.userId,
      })),
    });
    if (log.ok) {
      await prisma.complianceItem.updateMany({
        where: { id: { in: log.itemIds } },
        data: { reminderCount: { increment: 1 }, lastReminderAt: now },
      });
    }
  }

  return NextResponse.json({ results });
}

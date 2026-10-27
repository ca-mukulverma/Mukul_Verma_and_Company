import { NextRequest, NextResponse } from "next/server";
import { Company } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, partyName, renderMessage } from "@/lib/compliance";
import { clientContactSelect, reminderRecipients } from "@/lib/client-contacts";
import { periodLabel } from "@/lib/compliance-periods";
import { emailsSentToday, firmName, GMAIL_DAILY_LIMIT, sendComplianceEmails } from "@/lib/compliance-email";
import { parseEmailList } from "@/lib/bill-email";
import { badRequest, forbidden, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(1000),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  // Changed text from the dialog; {client} etc. are still filled in per client
  message: z.string().trim().max(2000).optional().nullable(),
  // Reminders go to the responsible person; this also sends them to the owner
  alsoOwner: z.boolean().optional(),
});

// POST /api/compliance/reminders – one reminder per client (to its responsible
// person, and the owner if asked), covering all of its selected items. WhatsApp: returns the links to open (counted as sent).
// Email: sends from the company's Gmail.
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { itemIds, channel, message, alsoOwner } = body.data;

  const items = await prisma.complianceItem.findMany({
    where: { id: { in: itemIds }, historical: false },
    include: {
      workType: true,
      client: { select: clientContactSelect },
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

  const results: { key: string; clientId: string; name: string; ok: boolean; error?: string; phone?: string; text?: string }[] = [];
  const logs: { itemIds: string[]; sentTo: string; ok: boolean; error?: string }[] = [];

  if (channel === "WHATSAPP") {
    for (const r of reminders) {
      const name = partyName(r.client);
      for (const person of reminderRecipients(r.client, alsoOwner)) {
        const label = person.role === "owner" ? `${name} (owner ${person.name})` : r.client.ownerIsResponsible ? name : `${name} (${person.name})`;
        const key = `${r.client.id}:${person.role}`;
        if (!person.whatsapp) {
          results.push({ key, clientId: r.client.id, name: label, ok: false, error: `No WhatsApp number for ${person.role === "owner" ? "the owner" : "the responsible person"}` });
          continue;
        }
        results.push({ key, clientId: r.client.id, name: label, ok: true, phone: person.whatsapp, text: r.text });
        logs.push({ itemIds: r.group.map((i) => i.id), sentTo: person.whatsapp, ok: true });
      }
    }
  } else {
    const sentToday = await emailsSentToday();
    if (sentToday + reminders.length > GMAIL_DAILY_LIMIT) {
      return badRequest(
        `About ${sentToday} emails have gone out today; sending ${reminders.length} more could pass Gmail's daily limit of ${GMAIL_DAILY_LIMIT}. Send fewer now and the rest tomorrow`
      );
    }
    for (const company of ["MVC", "BEDGE"] as Company[]) {
      const batch = reminders
        .filter((r) => r.company === company)
        .map((r) => {
          const addresses = [...new Set(reminderRecipients(r.client, alsoOwner).flatMap((p) => parseEmailList(p.email ?? "") ?? []))];
          return { ...r, to: addresses };
        });
      const sendable = batch.filter((r) => r.to.length > 0);
      for (const r of batch.filter((b) => !sendable.includes(b))) {
        results.push({ key: r.client.id, clientId: r.client.id, name: partyName(r.client), ok: false, error: "No valid email address for the responsible person" });
      }
      if (sendable.length === 0) continue;
      const failures = await sendComplianceEmails(
        company,
        sendable.map((r) => ({ to: r.to, subject: r.subject, text: r.text }))
      );
      sendable.forEach((r, i) => {
        const failure = failures[i];
        results.push({ key: r.client.id, clientId: r.client.id, name: partyName(r.client), ok: !failure, ...(failure && { error: failure }) });
        logs.push({ itemIds: r.group.map((it) => it.id), sentTo: r.to.join(", "), ok: !failure, ...(failure && { error: failure }) });
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

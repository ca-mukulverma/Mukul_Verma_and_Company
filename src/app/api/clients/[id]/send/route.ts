import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, completeIfReady, logEvent } from "@/lib/compliance";
import { badRequest, forbidden, monthString, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { emailsSentToday, firmName, GMAIL_DAILY_LIMIT, sendComplianceEmails } from "@/lib/compliance-email";
import { addMonths, parseMonthKey } from "@/lib/compliance-periods";
import { BILLING_COMPANIES, BILLING_MAILBOXES, billingEmailConfigured, parseEmailList, senderName } from "@/lib/bill-email";
import { getBillingAccess } from "@/lib/billing";
import { loadBillDocuments } from "@/lib/bill-document";
import { renderBill } from "@/lib/bill-files";
import { downloadUrl, r2Configured, readObject } from "@/lib/r2";
import { DETAIL_FIELDS, DetailField, requestConfigSchema } from "@/lib/client-requests";
import {
  buildEmailText,
  buildPreview,
  clientEmails,
  documentLabel,
  loadDispatchClient,
  loadDocs,
  rangeMonths,
  serializeRequestType,
} from "@/lib/client-dispatch";

// Send to Client (see docs/CLIENT_REQUESTS.md). Any staff member can send
// files and details; portal logins only Admin, and only to the client's own
// email addresses.

// Gmail accepts about 25 MB per email; above this, links are sent instead
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const LINK_DAYS = 7;
const MAX_RANGE_MONTHS = 60;

function parseRange(fromKey: string | null, toKey: string | null) {
  const from = parseMonthKey(fromKey);
  const to = parseMonthKey(toKey);
  if (!from || !to) return null;
  if (from > to || addMonths(from, MAX_RANGE_MONTHS) <= to) return "invalid" as const;
  return { from, to };
}

// GET /api/clients/[id]/send?requestId=…&from=YYYY-MM&to=YYYY-MM&years=N
// – what the request picks for this client, to check before sending.
// requestId "custom" picks nothing, for staff to tick themselves.
// ?history=1 – the last emails sent from Send to Client.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const search = request.nextUrl.searchParams;

  if (search.get("history") === "1") {
    const rows = await prisma.clientDispatch.findMany({
      where: { clientId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { sentBy: { select: { name: true } } },
    });
    return NextResponse.json({
      history: rows.map((r) => ({
        id: r.id,
        requestName: r.requestName,
        sentTo: r.sentTo,
        thirdParty: r.thirdParty,
        includedLogins: r.includedLogins,
        files: r.files,
        sentBy: r.sentBy?.name ?? null,
        createdAt: r.createdAt,
      })),
    });
  }

  const client = await loadDispatchClient(id);
  if (!client) return notFound("Client not found");

  const requestId = search.get("requestId") || "custom";
  let config = requestConfigSchema.parse({});
  if (requestId !== "custom") {
    const row = await prisma.clientRequestType.findUnique({ where: { id: requestId } });
    if (!row) return notFound("Request not found");
    const view = serializeRequestType(row);
    if (view.adminOnly && !access.isAdmin) return forbidden("Only Admin can send portal logins");
    config = view.config;
  }

  const asked = parseRange(search.get("from"), search.get("to"));
  if (asked === "invalid") return badRequest(`Choose a period of up to ${MAX_RANGE_MONTHS} months, the first month before the last`);
  const range = asked ?? rangeMonths(config.range);
  const years = Math.min(10, Math.max(1, Number(search.get("years")) || config.years));

  const preview = await buildPreview({
    client,
    config,
    range,
    years,
    isAdmin: access.isAdmin,
    billing: await getBillingAccess(access.userId),
  });
  const mailboxes = BILLING_COMPANIES.map((company) => ({
    company,
    from: `${senderName(BILLING_MAILBOXES[company], "Document")} <${BILLING_MAILBOXES[company].address}>`,
    configured: billingEmailConfigured(company),
  }));
  return NextResponse.json({ preview, mailboxes, sentToday: await emailsSentToday(), dailyLimit: GMAIL_DAILY_LIMIT, storageReady: r2Configured() });
}

const sendSchema = z.object({
  requestId: z.string().min(1).nullable().optional(),
  company: z.enum(["MVC", "BEDGE"]),
  to: z.string().trim().min(3, "Enter the email address"),
  note: z.string().trim().max(2000).optional().nullable(),
  documentIds: z.array(z.string().min(1)).max(80, "Send up to 80 files at a time").default([]),
  billIds: z.array(z.string().min(1)).max(30, "Send up to 30 bills at a time").default([]),
  credentialIds: z.array(z.string().min(1)).max(20).default([]),
  details: z.array(z.enum(Object.keys(DETAIL_FIELDS) as [DetailField, ...DetailField[]])).default([]),
  statement: z.object({ from: monthString, to: monthString }).nullable().optional(),
});

// POST /api/clients/[id]/send – emails the chosen files and details from the
// company's mailbox as "Document-CA Mukul Verma" / "Document-B Edge"
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const body = parseBody(sendSchema, await request.json());
  if (body.error) return body.error;
  const input = body.data;

  const client = await loadDispatchClient(id);
  if (!client) return notFound("Client not found");
  const to = parseEmailList(input.to);
  if (!to) return badRequest("Enter up to 5 valid email addresses, separated by commas");
  const own = clientEmails(client);
  const thirdParty = to.some((a) => !own.includes(a));

  if (!input.documentIds.length && !input.billIds.length && !input.credentialIds.length && !input.details.length && !input.statement) {
    return badRequest("Choose something to send");
  }

  const requestRow = input.requestId ? await prisma.clientRequestType.findUnique({ where: { id: input.requestId } }) : null;
  const requestName = requestRow?.name ?? "Documents";

  // Files
  const docs = await loadDocs(input.documentIds);
  if (docs.length !== new Set(input.documentIds).size || docs.some((d) => d.clientId !== client.id)) return notFound("Some files were not found");
  if (docs.length && !r2Configured()) return badRequest("Document storage (Cloudflare R2) is not set up yet. See docs/COMPLIANCE.md");

  // Bills, and the statement of bills: Billing List users only
  const needsBilling = input.billIds.length > 0 || !!input.statement;
  const billing = needsBilling ? await getBillingAccess(access.userId) : null;
  if (needsBilling && (!billing || billing.listCompanies.length === 0)) {
    return forbidden("Bills can only be sent by billing managers and partners who see the Billing List");
  }
  let billDocs: Awaited<ReturnType<typeof loadBillDocuments>> = [];
  if (input.billIds.length) {
    const owned = await prisma.bill.count({ where: { id: { in: input.billIds }, clientId: client.id } });
    billDocs = await loadBillDocuments(input.billIds, billing!);
    if (owned !== input.billIds.length || billDocs.length !== input.billIds.length || billDocs.some((b) => b.cancelled)) {
      return notFound("Some bills were not found");
    }
  }
  let statement: { from: Date; to: Date; bills: typeof billDocs } | null = null;
  if (input.statement) {
    const range = parseRange(input.statement.from, input.statement.to);
    if (!range || range === "invalid") return badRequest("Choose the period of the statement");
    const ids = await prisma.bill.findMany({
      where: {
        clientId: client.id,
        status: "approved",
        company: { in: billing!.listCompanies },
        billDate: { gte: range.from, lt: addMonths(range.to, 1) },
      },
      orderBy: { billDate: "asc" },
      select: { id: true },
    });
    statement = { ...range, bills: await loadBillDocuments(ids.map((b) => b.id), billing!) };
  }

  // Portal logins: Admin only, and never to a third party
  let logins: { title: string; username: string; password: string }[] = [];
  if (input.credentialIds.length) {
    if (!access.isAdmin) return forbidden("Only Admin can send portal logins");
    if (thirdParty) {
      return badRequest(`Portal logins can only go to the client's own email address${own.length ? ` (${own.join(", ")})` : ""}. Remove the logins or the other addresses`);
    }
    const credentials = await prisma.credential.findMany({ where: { id: { in: input.credentialIds }, clientId: client.id }, orderBy: { title: "asc" } });
    if (credentials.length !== new Set(input.credentialIds).size) return notFound("Some logins were not found");
    logins = credentials.map((c) => ({ title: c.title, username: c.username, password: c.password }));
  }

  if ((await emailsSentToday()) >= GMAIL_DAILY_LIMIT) {
    return badRequest(`About ${GMAIL_DAILY_LIMIT} emails have gone out today, Gmail's daily limit. Send this tomorrow`);
  }

  // Attach the files, or send download links if they are too big together
  const totalSize = docs.reduce((sum, d) => sum + d.size, 0);
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  let links = "";
  if (docs.length) {
    if (totalSize <= MAX_ATTACHMENT_BYTES) {
      try {
        attachments.push(
          ...(await Promise.all(
            docs.map(async (d) => {
              const stored = await readObject(d.storageKey);
              return { filename: d.fileName, content: d.gzipped ? gunzipSync(stored) : stored, contentType: d.contentType };
            })
          ))
        );
      } catch (e) {
        console.error("Failed to read files from storage:", e);
        return NextResponse.json({ error: "The files could not be read from storage. Try again in a while" }, { status: 502 });
      }
    } else {
      const urls = await Promise.all(docs.map((d) => downloadUrl(d.storageKey, d.fileName, LINK_DAYS * 86_400)));
      links =
        `The files are large, so they can be downloaded here (links work for ${LINK_DAYS} days):\n` +
        docs.map((d, i) => `${documentLabel(d)}: ${urls[i]}`).join("\n");
    }
  }
  for (const bill of billDocs) {
    attachments.push({
      filename: `Bill-${bill.billNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
      content: Buffer.from(await renderBill(bill, "pdf")),
      contentType: "application/pdf",
    });
  }

  const firm = firmName(input.company);
  const text = await buildEmailText({
    client,
    firm,
    docs,
    billDocs,
    details: input.details,
    logins,
    statement,
    note: input.note || null,
    attached: !links,
    links,
  });
  const subject = `${requestName} – ${client.companyName || client.contactPerson}`;

  const [failure] = await sendComplianceEmails(input.company, "Document", [
    { to, subject, text, attachments: attachments.length ? attachments : undefined },
  ]);
  if (failure) return NextResponse.json({ error: failure }, { status: 502 });

  const sentTo = to.join(", ");
  await prisma.clientDispatch.create({
    data: {
      clientId: client.id,
      requestName: requestName.slice(0, 100),
      company: input.company,
      sentTo: sentTo.slice(0, 400),
      thirdParty,
      files: [...docs.map((d) => ({ name: d.fileName, label: documentLabel(d) })), ...billDocs.map((b) => ({ name: `Bill ${b.billNumber}`, label: `Bill ${b.billNumber}` }))],
      includedLogins: logins.length > 0,
      sentById: access.userId,
    },
  });

  // On each period's history; a Form 16/16A emailed this way also ticks
  // that step, as from the compliance sheet
  const itemIds = [...new Set(docs.map((d) => d.itemId).filter((itemId): itemId is string => !!itemId))];
  for (const itemId of itemIds) {
    await logEvent(prisma, itemId, "sent_to_client", access.userId, `${requestName}, to ${sentTo}`);
  }
  const certItemIds = [...new Set(docs.filter((d) => d.kind === "CERTIFICATE" && d.itemId).map((d) => d.itemId!))];
  const certItems = await prisma.complianceItem.findMany({
    where: { id: { in: certItemIds }, status: "filed", certRequestedAt: { not: null }, certEmailedAt: null },
    select: { id: true, workTypeId: true },
  });
  for (const item of certItems.filter((it) => canWorkOn(access, it.workTypeId))) {
    await prisma.complianceItem.update({
      where: { id: item.id },
      data: { certEmailedAt: new Date(), certEmailedTo: sentTo.slice(0, 400), updatedById: access.userId },
    });
    await logEvent(prisma, item.id, "certificates_emailed", access.userId, `To ${sentTo}`);
    await completeIfReady(item.id, access.userId);
  }

  return NextResponse.json({ ok: true, thirdParty, sentTo });
}

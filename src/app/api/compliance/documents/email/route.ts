import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, completeIfReady, logEvent, partyName } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { periodLabel } from "@/lib/compliance-periods";
import { sendComplianceEmails } from "@/lib/compliance-email";
import { composeEmail, emailSubject } from "@/lib/email-layout";
import { filingLines } from "@/lib/client-dispatch";
import { parseEmailList } from "@/lib/bill-email";
import { badRequest, forbidden, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { downloadUrl, r2Configured, readObject } from "@/lib/r2";

// Gmail accepts about 25 MB per email; above this, links are sent instead
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const LINK_DAYS = 7;

const schema = z.object({
  docIds: z.array(z.string().min(1)).min(1, "Select the files to send").max(50),
  to: z.string().trim().min(3, "Enter the email address"),
  note: z.string().trim().max(2000).optional().nullable(),
  // Emailing a TDS return's Form 16/16A: ticks its last step
  certificateItemId: z.string().min(1).optional().nullable(),
});

// POST /api/compliance/documents/email – sends files to the client from the
// company's Gmail; any staff member can do this
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { docIds, note, certificateItemId } = body.data;

  if (!r2Configured()) return badRequest("Document storage (Cloudflare R2) is not set up yet. See docs/COMPLIANCE.md");
  const to = parseEmailList(body.data.to);
  if (!to) return badRequest("Enter up to 5 valid email addresses, separated by commas");

  const docs = await prisma.complianceDocument.findMany({
    where: { id: { in: docIds } },
    include: {
      client: { select: { contactPerson: true, companyName: true } },
      item: { select: { id: true, frequency: true, periodStart: true, workType: { select: { name: true, company: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (docs.length !== docIds.length) return notFound("Some files were not found");
  if (new Set(docs.map((d) => d.clientId)).size > 1) return badRequest("Send one client's files at a time");

  const certItem = certificateItemId
    ? await prisma.complianceItem.findUnique({ where: { id: certificateItemId }, include: { workType: true } })
    : null;
  if (certificateItemId) {
    if (!certItem) return notFound("Item not found");
    if (!canWorkOn(access, certItem.workTypeId)) return forbidden();
    if (certItem.status !== "filed") return badRequest("Mark the return filed first");
    if (!certItem.certRequestedAt) return badRequest("Mark the Form 16/16A request first");
  }

  const company = certItem?.workType.company ?? docs.find((d) => d.item)?.item?.workType.company ?? "MVC";
  const party = partyName(docs[0].client);

  // Attach the files, or send download links if they are too big together
  const totalSize = docs.reduce((sum, d) => sum + d.size, 0);
  let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined;
  let links = "";
  if (totalSize <= MAX_ATTACHMENT_BYTES) {
    try {
      attachments = await Promise.all(
        docs.map(async (d) => {
          const stored = await readObject(d.storageKey);
          return { filename: d.fileName, content: d.gzipped ? gunzipSync(stored) : stored, contentType: d.contentType };
        })
      );
    } catch (e) {
      console.error("Failed to read files from storage:", e);
      return NextResponse.json({ error: "The files could not be read from storage. Try again in a while" }, { status: 502 });
    }
  } else {
    const urls = await Promise.all(docs.map((d) => downloadUrl(d.storageKey, d.fileName, LINK_DAYS * 86_400)));
    links = docs.map((d, i) => `${d.fileName}: ${urls[i]}`).join("\n");
  }

  const what = certItem
    ? `${certItem.workType.name === "TDS Return 24Q" ? "Form 16" : "Form 16A"} for ${certItem.workType.name}, ${periodLabel(certItem.frequency, certItem.periodStart)}`
    : [...new Set(docs.map((d) => (d.item ? `${d.item.workType.name} ${periodLabel(d.item.frequency, d.item.periodStart)}` : d.fileName)))].join(", ");
  const filings = await filingLines([...new Set(docs.map((d) => d.itemId).filter((id): id is string => !!id))]);
  const { html, text } = await composeEmail(company, {
    greetingName: docs[0].client.contactPerson,
    paragraphs: [
      `Please find ${attachments ? "attached" : "below the download links for"} the ${what} for ${party}.`,
    ],
    sections: [
      { title: attachments ? "Attached" : `Download links (valid for ${LINK_DAYS} days)`, lines: links ? links.split("\n") : docs.map((d) => d.fileName), numbered: true },
      ...(filings.length ? [{ title: "Filing details", lines: filings }] : []),
    ],
    after: [note ?? "", "Please feel free to contact us for any clarification."],
  });

  const [failure] = await sendComplianceEmails(company, "Document", [{ to, subject: emailSubject(what, party, company), text, html, attachments }]);
  if (failure) return NextResponse.json({ error: failure }, { status: 502 });

  const itemIds = [...new Set(docs.map((d) => d.itemId).filter((id): id is string => !!id))];
  for (const itemId of itemIds) {
    await logEvent(prisma, itemId, "documents_emailed", access.userId, `To ${to.join(", ")}`);
  }
  if (certItem) {
    await prisma.complianceItem.update({
      where: { id: certItem.id },
      data: { certEmailedAt: new Date(), certEmailedTo: to.join(", ").slice(0, 400), updatedById: access.userId },
    });
    await logEvent(prisma, certItem.id, "certificates_emailed", access.userId, `To ${to.join(", ")}`);
    await completeIfReady(certItem.id, access.userId);
  }

  return NextResponse.json({ ok: true, item: certItem ? await loadSheetItem(certItem.id, access) : null });
}

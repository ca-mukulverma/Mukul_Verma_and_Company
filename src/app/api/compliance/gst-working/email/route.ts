import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { parseEmailList } from "@/lib/bill-email";
import { sendComplianceEmails } from "@/lib/compliance-email";
import { composeEmail, emailSubject } from "@/lib/email-layout";
import { clientWorking } from "@/lib/gst-working";
import { workingExcel, workingFileName, workingPdf } from "@/lib/gst-working-export";

const schema = z.object({
  clientId: z.string().min(1),
  fy: z.number().int().min(2017).max(2100),
  to: z.string().trim().min(3, "Enter the email address"),
  note: z.string().trim().max(2000).optional().nullable(),
});

// POST /api/compliance/gst-working/email – sends the client their GST working
// (Excel and PDF) from the company's Gmail
export async function POST(request: NextRequest) {
  const { error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { clientId, fy, note } = body.data;
  const to = parseEmailList(body.data.to);
  if (!to) return badRequest("Enter up to 5 valid email addresses, separated by commas");

  const working = await clientWorking(clientId, fy);
  if (!working) return notFound("Client not found");
  // The firm that does the client's GST sends it
  const gst = await prisma.clientCompliance.findFirst({
    where: { clientId, workType: { kind: { in: ["GSTR3B", "GSTR1"] } } },
    select: { workType: { select: { company: true } } },
  });
  const company = gst?.workType.company ?? "MVC";
  const fyLabel = `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
  const contact = await prisma.client.findUnique({ where: { id: clientId }, select: { contactPerson: true } });
  const { html, text } = await composeEmail(company, {
    greetingName: contact?.contactPerson,
    paragraphs: [
      `Please find attached the GST working of ${working.client.name}${working.client.gstin ? ` (GSTIN ${working.client.gstin})` : ""} for FY ${fyLabel}, month by month, in Excel and PDF.`,
    ],
    sections: [
      {
        title: "The working covers",
        lines: [
          "Sales as per GSTR-1 and GSTR-1A compared with GSTR-3B",
          "Tax payable under reverse charge (RCM) compared with the RCM credit taken",
          "Input tax credit claimed in GSTR-3B compared with GSTR-2B, including ineligible and rejected credit",
        ],
        numbered: true,
      },
    ],
    after: [note ?? "", "Please go through it and let us know if any figure needs a correction."],
  });
  const [failure] = await sendComplianceEmails(company, "Document", [
    {
      to,
      subject: emailSubject(`GST working for FY ${fyLabel}`, working.client.name, company),
      text,
      html,
      attachments: [
        { filename: workingFileName(working, "xlsx"), content: await workingExcel(working), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        { filename: workingFileName(working, "pdf"), content: workingPdf(working), contentType: "application/pdf" },
      ],
    },
  ]);
  if (failure) return badRequest(`The email was not sent: ${failure}`);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, parseBody, requireComplianceAccess } from "@/lib/compliance-api";
import { parseEmailList } from "@/lib/bill-email";
import { firmName, sendComplianceEmails } from "@/lib/compliance-email";
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
  const [failure] = await sendComplianceEmails(company, "Document", [
    {
      to,
      subject: `GST working FY ${fyLabel} – ${working.client.name}`,
      text: [
        `Dear ${working.client.name},`,
        "",
        `Please find attached your GST working for FY ${fyLabel} (sales as per GSTR-1 and GSTR-1A against GSTR-3B, RCM, and ITC as per GSTR-3B against GSTR-2B), month by month.`,
        ...(note ? ["", note] : []),
        "",
        "Regards,",
        firmName(company),
      ].join("\n"),
      attachments: [
        { filename: workingFileName(working, "xlsx"), content: await workingExcel(working), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        { filename: workingFileName(working, "pdf"), content: workingPdf(working), contentType: "application/pdf" },
      ],
    },
  ]);
  if (failure) return badRequest(`The email was not sent: ${failure}`);
  return NextResponse.json({ ok: true });
}

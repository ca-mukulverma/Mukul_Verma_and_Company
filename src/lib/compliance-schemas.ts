import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, money, monthString, notFound } from "@/lib/compliance-api";
import { CLIENT_DOC_TYPE_KEYS, clientDocType } from "@/lib/client-documents";
import { parseMonthKey } from "@/lib/compliance-periods";
import { FORM_LABELS, GstRead } from "@/lib/gst-read/types";
import { monthLabel } from "@/lib/gst-read/working";
import { placementOf } from "@/lib/gst-working";

// Request shapes and checks shared by several /api/compliance routes

// Largest file kept, after the browser has compressed it
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const ALLOWED_TYPES = [
  "application/pdf",
  "application/json",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "image/jpeg",
  "image/png",
];

// The figures read from a GST return file (see lib/gst-read/types.ts)
export const gstReadSchema = z
  .object({
    form: z.enum(["GSTR1", "IFF", "GSTR1A", "GSTR3B", "GSTR2B"]),
    source: z.enum(["JSON", "PDF"]),
    gstin: z.string().regex(/^\d{2}[A-Z0-9]{13}$/),
    month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    quarterly: z.boolean(),
  })
  .passthrough()
  .refine((g) => JSON.stringify(g).length < 20_000, "The figures read from the file are too large");

export type GstReadInput = z.infer<typeof gstReadSchema>;

export const uploadSchema = z.object({
  clientId: z.string().min(1),
  itemId: z.string().min(1).optional().nullable(),
  kind: z.enum(["RETURN_PDF", "RETURN_JSON", "GSTR1A_PDF", "GSTR1A_JSON", "GSTR2B_JSON", "CHALLAN", "CERTIFICATE", "OTHER"]),
  fileName: z.string().trim().min(1).max(150),
  contentType: z.enum(ALLOWED_TYPES as [string, ...string[]], { errorMap: () => ({ message: "Upload a PDF, JSON, Excel, CSV, ZIP or image file" }) }),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES, "The file is larger than 15 MB"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  gzipped: z.boolean(),
  // The client's own documents (Client → Documents): their type and, for
  // yearly ones, the financial year (2025 = FY 2025-26)
  docType: z.enum(CLIENT_DOC_TYPE_KEYS).optional().nullable(),
  financialYear: z.number().int().min(2000).max(2100).optional().nullable(),
  // GST returns: the figures the browser read from the file (lib/gst-read)
  gst: gstReadSchema.optional().nullable(),
});

// Same content → same stored object, so a file uploaded twice is kept once
export function storageKey(clientId: string, sha256: string, gzipped: boolean) {
  return `clients/${clientId}/${sha256}${gzipped ? ".gz" : ""}`;
}

// Checks that the user may add this file to the client / item
export async function checkUploadAllowed(
  access: { userId: string },
  data: z.infer<typeof uploadSchema>,
  canWork: (workTypeId: string) => boolean
) {
  if (data.docType) {
    if (data.itemId) return badRequest("A client document can't belong to a period");
    if (clientDocType(data.docType)?.yearly && !data.financialYear) return badRequest("Choose the financial year");
  }
  if (data.itemId) {
    const item = await prisma.complianceItem.findUnique({
      where: { id: data.itemId },
      select: { clientId: true, workTypeId: true, periodStart: true, periodEnd: true, workType: { select: { kind: true } } },
    });
    if (!item || item.clientId !== data.clientId) return notFound("Item not found");
    if (!canWork(item.workTypeId)) return forbidden();
    // A GST return must go to its own work and period
    if (data.gst) {
      const label = `${FORM_LABELS[data.gst.form]} of ${monthLabel(data.gst.month)}`;
      if (placementOf(data.gst as unknown as GstRead).work !== item.workType.kind) return badRequest(`This is a ${label}: it belongs to ${placementOf(data.gst as unknown as GstRead).work === "GSTR1" ? "GSTR-1" : "GSTR-3B"}`);
      const month = parseMonthKey(data.gst.month)!;
      if (month < item.periodStart || month > item.periodEnd) return badRequest(`This is a ${label}, not of this period`);
    }
  } else if (data.gst) {
    return badRequest("A GST return goes to its period: upload it under the client's Upload documents or in the period");
  }
  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { gstin: true } });
  if (!client) return notFound("Client not found");
  if (data.gst && client.gstin && client.gstin.toUpperCase() !== data.gst.gstin) {
    return badRequest(`This file is for GSTIN ${data.gst.gstin}, not this client's (${client.gstin})`);
  }
  return null;
}

// A client's monthly RCM / TDS obligation (Compliance → Clients)
export const obligationSchema = z.object({
  kind: z.enum(["RCM", "TDS"]),
  category: z.string().trim().min(2, "Choose the category or section").max(60),
  payee: z.string().trim().min(2, "Enter who is paid").max(100),
  fixedAmount: money.nullable(),
  ratePercent: z.number().min(0).max(100),
  fromMonth: monthString,
  toMonth: monthString.nullable().optional(),
});

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { forbidden, money, monthString, notFound } from "@/lib/compliance-api";

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

export const uploadSchema = z.object({
  clientId: z.string().min(1),
  itemId: z.string().min(1).optional().nullable(),
  kind: z.enum(["RETURN_PDF", "RETURN_JSON", "GSTR1A_PDF", "GSTR1A_JSON", "CHALLAN", "CERTIFICATE", "OTHER"]),
  fileName: z.string().trim().min(1).max(150),
  contentType: z.enum(ALLOWED_TYPES as [string, ...string[]], { errorMap: () => ({ message: "Upload a PDF, JSON, Excel, CSV, ZIP or image file" }) }),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES, "The file is larger than 15 MB"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  gzipped: z.boolean(),
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
  if (data.itemId) {
    const item = await prisma.complianceItem.findUnique({
      where: { id: data.itemId },
      select: { clientId: true, workTypeId: true },
    });
    if (!item || item.clientId !== data.clientId) return notFound("Item not found");
    if (!canWork(item.workTypeId)) return forbidden();
  } else {
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
    if (!client) return notFound("Client not found");
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

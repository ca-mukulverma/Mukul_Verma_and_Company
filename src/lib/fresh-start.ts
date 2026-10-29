import cloudinary from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
import { deletePrefix, r2Configured } from "@/lib/r2";

// Fresh start (Settings → Data): removes all client work so the firm can load
// its clients again in one go. Staff and every setting are kept.

export async function freshStartCounts() {
  const [clients, tasks, bills, complianceItems, complianceDocuments, credentials, notifications, activities] = await Promise.all([
    prisma.client.count(),
    prisma.task.count(),
    prisma.bill.count(),
    prisma.complianceItem.count(),
    prisma.complianceDocument.count(),
    prisma.credential.count(),
    prisma.notification.count(),
    prisma.activity.count(),
  ]);
  return { clients, tasks, bills, complianceItems, complianceDocuments, credentials, notifications, activities };
}

export async function clearClientData(adminId: string, details: object) {
  await prisma.$transaction(
    async (tx) => {
      // Bills first: they point at tasks, clients and each other
      await tx.billChangeRequest.deleteMany();
      await tx.billEvent.deleteMany();
      await tx.bill.updateMany({ data: { reissuedFromId: null } });
      await tx.bill.deleteMany();
      await tx.tallyExport.deleteMany();
      // Numbering starts again at 1 (Billing → Number series can set it)
      await tx.billSeries.deleteMany();

      await tx.clientHistory.deleteMany();
      // Comments and assignees go with their tasks
      await tx.task.deleteMany();
      await tx.attachment.deleteMany();
      // Everything under a client goes with it: logins, compliance works,
      // periods, files, obligations, notes, GST working sign-offs, dispatches
      await tx.client.updateMany({ data: { parentClientId: null } });
      await tx.client.deleteMany();
      await tx.complianceNote.deleteMany();

      await tx.notification.deleteMany();
      await tx.activity.deleteMany();
      await tx.activity.create({
        data: { type: "system", action: "fresh_start", target: "All client data", details, userId: adminId },
      });
    },
    { timeout: 120_000 }
  );
}

// Task attachments and old chat files in Cloudinary; staff photos are kept
const CLOUDINARY_PREFIXES = ["office_management/task", "office_management/chat"];
const RESOURCE_TYPES = ["image", "raw", "video"] as const;

async function clearCloudinary() {
  let deleted = 0;
  for (const prefix of CLOUDINARY_PREFIXES) {
    for (const resource_type of RESOURCE_TYPES) {
      // At most 1000 per call; "partial" means more are left
      for (let round = 0; round < 50; round++) {
        const result = await cloudinary.api.delete_resources_by_prefix(prefix, { resource_type });
        deleted += Object.values(result?.deleted ?? {}).filter((v) => v === "deleted").length;
        if (!result?.partial) break;
      }
    }
  }
  return deleted;
}

// Removes the stored files; the database rows are already gone
export async function clearStoredFiles() {
  const result: { cloudinary: number | string; r2: number | string } = { cloudinary: 0, r2: 0 };
  if (process.env.CLOUDINARY_API_SECRET) {
    result.cloudinary = await clearCloudinary().catch((e) => `Not cleared: ${e?.error?.message ?? e?.message ?? "Cloudinary error"}`);
  }
  if (r2Configured()) {
    // Compliance files are stored under clients/<clientId>/
    result.r2 = await deletePrefix("clients/").catch((e) => `Not cleared: ${e?.message ?? "R2 error"}`);
  }
  return result;
}

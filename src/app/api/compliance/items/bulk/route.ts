import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canWorkOn, logEvent } from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { forbidden, parseBody, requireComplianceAccess } from "@/lib/compliance-api";

const schema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["data_received", "undo_data_received"]),
});

// POST /api/compliance/items/bulk – "Data received" for one row (GSTR-1 and
// GSTR-3B together) or for several selected rows at once
export async function POST(request: NextRequest) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const body = parseBody(schema, await request.json());
  if (body.error) return body.error;
  const { itemIds, action } = body.data;

  const items = await prisma.complianceItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, workTypeId: true, status: true, dataReceivedAt: true },
  });
  if (items.some((item) => !canWorkOn(access, item.workTypeId))) return forbidden();

  const changed: string[] = [];
  for (const item of items) {
    if (action === "data_received") {
      if (item.dataReceivedAt) continue;
      await prisma.complianceItem.update({
        where: { id: item.id },
        data: {
          dataReceivedAt: new Date(),
          ...(item.status === "pending" && { status: "data_received" }),
          updatedById: access.userId,
        },
      });
      await logEvent(prisma, item.id, "data_received", access.userId);
    } else {
      if (!item.dataReceivedAt) continue;
      await prisma.complianceItem.update({
        where: { id: item.id },
        data: {
          dataReceivedAt: null,
          ...(item.status === "data_received" && { status: "pending" }),
          updatedById: access.userId,
        },
      });
      await logEvent(prisma, item.id, "data_received_undone", access.userId);
    }
    changed.push(item.id);
  }

  const updated = await Promise.all(changed.map((id) => loadSheetItem(id, access)));
  return NextResponse.json({ items: updated.filter(Boolean) });
}

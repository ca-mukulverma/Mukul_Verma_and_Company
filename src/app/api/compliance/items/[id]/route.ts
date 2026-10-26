import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  canWorkOn,
  completeIfReady,
  computeLocks,
  FIGURE_FIELDS,
  logEvent,
  resolveTdsReturns,
  TDS_RETURN_REQUIRED_FIGURES,
  TDS_SECTIONS,
} from "@/lib/compliance";
import { loadSheetItem } from "@/lib/compliance-sheet";
import { parseDateKey, todayIST } from "@/lib/compliance-periods";
import { formatRupees } from "@/lib/billing-constants";
import {
  badRequest,
  dateString,
  forbidden,
  money,
  notFound,
  parseBody,
  requireComplianceAccess,
} from "@/lib/compliance-api";

const figures = z.record(z.string(), z.number().min(-1e13).max(1e13)).optional();

const actionSchema = z.discriminatedUnion("action", [
  // Filing details; also used to correct them later
  z.object({
    action: z.literal("file"),
    filedAt: dateString,
    arn: z.string().trim().max(50).optional().nullable(),
    isNil: z.boolean().optional().nullable(),
    figures,
  }),
  z.object({ action: z.literal("undo_filed") }),
  z.object({ action: z.literal("tax_payable"), amount: money.nullable() }),
  z.object({ action: z.literal("figures"), figures: z.record(z.string(), z.number().min(-1e13).max(1e13)) }),
  z.object({
    action: z.literal("gstr1a"),
    filed: z.boolean(),
    filedAt: dateString.optional().nullable(),
    arn: z.string().trim().max(50).optional().nullable(),
  }),
  z.object({
    action: z.literal("line"),
    lineId: z.string().min(1),
    status: z.enum(["pending", "confirmed", "skipped"]),
    baseAmount: money.optional().nullable(),
    taxAmount: money.optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
  }),
  z.object({
    action: z.literal("challan_add"),
    section: z.enum(TDS_SECTIONS as [string, ...string[]]),
    bsrCode: z.string().trim().regex(/^\d{7}$/, "BSR code has 7 digits").optional().nullable().or(z.literal("")),
    challanDate: dateString,
    serialNo: z.string().trim().max(10).optional().nullable(),
    amount: z.number().positive("Enter the challan amount").max(1e12),
  }),
  z.object({ action: z.literal("challan_remove"), challanId: z.string().min(1) }),
  z.object({ action: z.literal("tds_close"), noTds: z.boolean() }),
  z.object({ action: z.literal("tds_reopen") }),
  z.object({ action: z.literal("cert_requested"), date: dateString, requestNo: z.string().trim().max(50).optional().nullable() }),
  z.object({ action: z.literal("cert_undo") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("fee"), fee: money.nullable() }),
]);

// GET /api/compliance/items/[id] – one item with its history
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;
  const item = await loadSheetItem(id, access);
  if (!item) return notFound("Item not found");
  const [events, reminders, fee] = await Promise.all([
    prisma.complianceEvent.findMany({
      where: { itemId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, remark: true, createdAt: true, user: { select: { name: true } } },
    }),
    prisma.complianceReminder.findMany({
      where: { itemId: id },
      orderBy: { sentAt: "desc" },
      take: 20,
      select: { id: true, channel: true, sentTo: true, ok: true, error: true, sentAt: true, sentBy: { select: { name: true } } },
    }),
    // The fee is shown only to Admins and Partners
    access.isManager ? prisma.complianceItem.findUnique({ where: { id }, select: { fee: true } }) : null,
  ]);
  return NextResponse.json({
    item,
    events,
    reminders,
    ...(access.isManager && { fee: fee?.fee != null ? Number(fee.fee) : null }),
  });
}

function cleanFigures(kind: keyof typeof FIGURE_FIELDS, input: Record<string, number> | undefined, existing: unknown) {
  const allowed = new Set((FIGURE_FIELDS[kind] ?? []).map((f) => f.key));
  const result: Record<string, number> = { ...((existing as Record<string, number>) ?? {}) };
  for (const [key, value] of Object.entries(input ?? {})) if (allowed.has(key)) result[key] = value;
  return result;
}

// PATCH /api/compliance/items/[id] – everything staff do from the sheet
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, error } = await requireComplianceAccess();
  if (error) return error;
  const { id } = await params;

  const parsedBody = parseBody(actionSchema, await request.json());
  if (parsedBody.error) return parsedBody.error;
  const input = parsedBody.data;

  const item = await prisma.complianceItem.findUnique({
    where: { id },
    include: { workType: true, bill: { select: { id: true, status: true } } },
  });
  if (!item) return notFound("Item not found");
  if (!canWorkOn(access, item.workTypeId)) return forbidden();
  if (input.action === "fee" && !access.isManager) return forbidden("Only Admins and Partners can change the fee");

  const kind = item.workType.kind;
  const userId = access.userId;
  const touch = { updatedById: userId };
  const isOpen = item.status === "pending" || item.status === "data_received";

  switch (input.action) {
    case "file": {
      if (kind === "TDS_PAYMENT") return badRequest("Close a TDS payment with its challans instead");
      if (item.status === "completed" || item.status === "not_required") {
        return badRequest("This period is already closed. Reopen it first to change the filing details");
      }
      const filedAt = parseDateKey(input.filedAt);
      if (!filedAt || filedAt > todayIST()) return badRequest("The filing date can't be in the future");
      if (isOpen && !item.historical) {
        const locks = await computeLocks([{ ...item, kind }]);
        const lock = locks.get(item.id);
        if (lock) return badRequest(`Can't be filed yet: ${lock}`);
      }
      const newFigures = cleanFigures(kind, input.figures, item.figures);
      if (kind === "TDS_RETURN") {
        const missing = TDS_RETURN_REQUIRED_FIGURES.filter((key) => typeof newFigures[key] !== "number");
        if (missing.length) return badRequest("Enter the return figures: TDS deducted, deposited, deductees and challans");
        if (!input.arn) return badRequest("Enter the token / RRR number");
      }
      await prisma.$transaction(async (tx) => {
        await tx.complianceItem.update({
          where: { id },
          data: {
            status: "filed",
            filedAt,
            arn: input.arn || null,
            isNil: input.isNil ?? null,
            figures: newFigures as Prisma.InputJsonValue,
            ...touch,
          },
        });
        await logEvent(tx, id, isOpen ? "filed" : "filing_updated", userId, input.arn ? `ARN ${input.arn}` : null);
      });
      await completeIfReady(id, userId);
      break;
    }

    case "undo_filed": {
      if (item.status !== "filed") return badRequest("Only a filed period can be set back");
      await prisma.$transaction(async (tx) => {
        await tx.complianceItem.update({
          where: { id },
          data: { status: item.dataReceivedAt ? "data_received" : "pending", filedAt: null, ...touch },
        });
        await logEvent(tx, id, "filing_undone", userId);
      });
      break;
    }

    case "tax_payable": {
      await prisma.complianceItem.update({ where: { id }, data: { taxPayable: input.amount, ...touch } });
      await logEvent(prisma, id, "tax_payable", userId, input.amount !== null ? formatRupees(input.amount) : "cleared");
      break;
    }

    case "figures": {
      await prisma.complianceItem.update({
        where: { id },
        data: { figures: cleanFigures(kind, input.figures, item.figures) as Prisma.InputJsonValue, ...touch },
      });
      await logEvent(prisma, id, "figures_updated", userId);
      break;
    }

    case "gstr1a": {
      if (kind !== "GSTR1") return badRequest("GSTR-1A belongs to GSTR-1");
      const filedAt = input.filed && input.filedAt ? parseDateKey(input.filedAt) : null;
      if (input.filed && !filedAt) return badRequest("Enter the GSTR-1A filing date");
      await prisma.complianceItem.update({
        where: { id },
        data: { gstr1aFiled: input.filed, gstr1aFiledAt: filedAt, gstr1aArn: input.filed ? input.arn || null : null, ...touch },
      });
      await logEvent(prisma, id, input.filed ? "gstr1a_filed" : "gstr1a_removed", userId, input.arn ? `ARN ${input.arn}` : null);
      break;
    }

    case "line": {
      if (item.status === "completed") return badRequest("This period is already closed. Reopen it first");
      const line = await prisma.complianceObligationLine.findFirst({ where: { id: input.lineId, itemId: id } });
      if (!line) return notFound("Line not found");
      if (input.status === "confirmed" && input.taxAmount == null && line.taxAmount === null) {
        return badRequest("Enter this month's amount");
      }
      await prisma.complianceObligationLine.update({
        where: { id: line.id },
        data: {
          status: input.status,
          ...(input.baseAmount !== undefined && { baseAmount: input.baseAmount }),
          ...(input.taxAmount !== undefined && { taxAmount: input.taxAmount }),
          note: input.note ?? line.note,
          resolvedAt: input.status === "pending" ? null : new Date(),
        },
      });
      await prisma.complianceItem.update({ where: { id }, data: touch });
      await logEvent(prisma, id, `line_${input.status}`, userId, input.note);
      await completeIfReady(id, userId);
      break;
    }

    case "challan_add": {
      if (kind !== "TDS_PAYMENT") return badRequest("Challans belong to the TDS payment");
      if (item.status === "completed") return badRequest("This month is closed. Reopen it to add a challan");
      const challanDate = parseDateKey(input.challanDate);
      if (!challanDate) return badRequest("Enter the challan date");
      await prisma.tdsChallan.create({
        data: {
          itemId: id,
          section: input.section,
          bsrCode: input.bsrCode || null,
          challanDate,
          serialNo: input.serialNo || null,
          amount: input.amount,
        },
      });
      await prisma.complianceItem.update({ where: { id }, data: { noTds: false, ...touch } });
      await logEvent(prisma, id, "challan_added", userId, `${input.section}: ${formatRupees(input.amount)}`);
      break;
    }

    case "challan_remove": {
      if (item.status === "completed") return badRequest("This month is closed. Reopen it to remove a challan");
      const { count } = await prisma.tdsChallan.deleteMany({ where: { id: input.challanId, itemId: id } });
      if (count === 0) return notFound("Challan not found");
      await logEvent(prisma, id, "challan_removed", userId);
      break;
    }

    case "tds_close": {
      if (kind !== "TDS_PAYMENT") return badRequest("Only a TDS payment month can be closed this way");
      if (item.status === "completed") return badRequest("This month is already closed");
      const [challans, pendingLines] = await Promise.all([
        prisma.tdsChallan.count({ where: { itemId: id } }),
        prisma.complianceObligationLine.count({ where: { itemId: id, status: "pending" } }),
      ]);
      if (pendingLines > 0) return badRequest("Confirm or skip every TDS line first");
      if (!input.noTds && challans === 0) return badRequest("Add the challans, or mark “No TDS this month”");
      if (input.noTds && challans > 0) return badRequest("This month has challans; remove them to mark it “No TDS”");
      await prisma.$transaction(async (tx) => {
        await tx.complianceItem.update({
          where: { id },
          data: { status: "completed", noTds: input.noTds, completedAt: new Date(), ...touch },
        });
        await logEvent(tx, id, input.noTds ? "no_tds" : "tds_paid", userId);
      });
      await resolveTdsReturns([item.clientId]);
      break;
    }

    case "tds_reopen": {
      if (kind !== "TDS_PAYMENT" || item.status !== "completed") return badRequest("Only a closed TDS month can be reopened");
      await prisma.$transaction(async (tx) => {
        await tx.complianceItem.update({
          where: { id },
          data: { status: item.dataReceivedAt ? "data_received" : "pending", noTds: false, completedAt: null, ...touch },
        });
        await logEvent(tx, id, "reopened", userId);
      });
      await resolveTdsReturns([item.clientId]);
      break;
    }

    case "cert_requested": {
      if (kind !== "TDS_RETURN") return badRequest("Form 16/16A belongs to a TDS return");
      if (item.status !== "filed") return badRequest("Mark the return filed first");
      const date = parseDateKey(input.date);
      if (!date || date > todayIST()) return badRequest("Enter the request date");
      await prisma.complianceItem.update({
        where: { id },
        data: { certRequestedAt: date, certRequestNo: input.requestNo || null, ...touch },
      });
      await logEvent(prisma, id, "certificates_requested", userId, input.requestNo ? `Request ${input.requestNo}` : null);
      await completeIfReady(id, userId);
      break;
    }

    case "cert_undo": {
      if (item.status !== "filed") return badRequest("This period is already closed. Reopen it first");
      await prisma.complianceItem.update({
        where: { id },
        data: { certRequestedAt: null, certRequestNo: null, ...touch },
      });
      await logEvent(prisma, id, "certificates_request_undone", userId);
      break;
    }

    case "reopen": {
      if (item.status !== "completed" || kind === "TDS_PAYMENT") return badRequest("Only a completed period can be reopened");
      if (item.bill && item.bill.status !== "draft") {
        return badRequest("Its bill is already being processed in Billing. Ask the billing manager to mark it not billable first");
      }
      await prisma.$transaction(async (tx) => {
        await tx.complianceItem.update({
          where: { id },
          data: { status: "filed", completedAt: null, billId: null, ...touch },
        });
        // The draft bill is removed; completing the item again makes a new one
        if (item.bill) await tx.bill.delete({ where: { id: item.bill.id } });
        await logEvent(tx, id, "reopened", userId, item.bill ? "Draft bill removed" : null);
      });
      break;
    }

    case "fee": {
      await prisma.complianceItem.update({ where: { id }, data: { fee: input.fee, ...touch } });
      await logEvent(prisma, id, "fee_set", userId, input.fee !== null ? formatRupees(input.fee) : "cleared");
      break;
    }
  }

  return NextResponse.json(await loadSheetItem(id, access));
}

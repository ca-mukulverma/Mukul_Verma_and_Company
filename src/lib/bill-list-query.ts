import { BillStatus, BillType, Company, Prisma } from "@prisma/client";
import { BillingAccess } from "@/lib/billing";

// The bills a request asks for, shared by the bill lists and the Excel export:
// ?view=manage|list|amounts|mine&company=MVC|BEDGE&status=...&search=...
//   manage  – bills of the companies the user manages
//   list    – the Billing List: numbered bills of the bill types the user may
//             see (BillingAccess.listTypes), filtered by &type=<BillType>
//             &from=YYYY-MM-DD&to=YYYY-MM-DD (bill date)
//             &emailed=yes (delivered, as far as is known) | failed | no (never emailed)
//   amounts – bills sent to the user to enter the amount
//   mine    – work the user logged or completed
export function billListWhere(
  searchParams: URLSearchParams,
  access: BillingAccess
): { where: Prisma.BillWhereInput } | { error: string; status: number } {
  const view = searchParams.get("view") || "mine";
  const company = searchParams.get("company");
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();

  const where: Prisma.BillWhereInput = {};

  if (view === "manage" || view === "list") {
    // Partners allowed to see the Billing List see the companies of their bill types
    const allowed = view === "list" ? access.listCompanies : access.manages;
    const companies = company ? [company as Company] : allowed;
    if (companies.length === 0 || companies.some((c) => !allowed.includes(c))) {
      return { error: "Insufficient permissions", status: 403 };
    }
    where.company = { in: companies };

    if (view === "list") {
      const type = searchParams.get("type");
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      if (type && type !== "all") {
        if (!(type in BillType)) return { error: "Invalid type", status: 400 };
        if (!access.listTypes.includes(type as BillType)) return { error: "Insufficient permissions", status: 403 };
        where.type = type as BillType;
      } else {
        // Only the Billing Lists Admin allowed
        where.type = { in: access.listTypes };
      }
      if (from || to) {
        where.billDate = {
          // Dates are Indian calendar days
          ...(from && { gte: new Date(`${from}T00:00:00+05:30`) }),
          ...(to && { lte: new Date(`${to}T23:59:59.999+05:30`) }),
        };
      }
      if (!status || status === "all") where.status = { in: ["approved", "cancelled"] };
      const emailed = searchParams.get("emailed");
      if (emailed === "yes") where.emailStatus = { in: ["sent", "delayed"] };
      if (emailed === "failed") where.emailStatus = "failed";
      if (emailed === "no") where.emailStatus = null;
    }
  } else if (view === "amounts") {
    if (!access.canEnterAmounts) return { error: "Insufficient permissions", status: 403 };
    where.amountRequestedFromId = access.userId;
    if (!status) where.status = "awaiting_amount";
  } else {
    where.createdById = access.userId;
  }

  if (status && status !== "all") {
    if (view === "list" && status !== "approved" && status !== "cancelled") {
      return { error: "Invalid status", status: 400 };
    }
    if (!(status in BillStatus)) return { error: "Invalid status", status: 400 };
    where.status = status as BillStatus;
  }

  if (search) {
    where.OR = [
      { description: { contains: search, mode: "insensitive" } },
      { client: { contactPerson: { contains: search, mode: "insensitive" } } },
      { client: { companyName: { contains: search, mode: "insensitive" } } },
      { billToName: { contains: search, mode: "insensitive" } },
    ];
  }

  return { where };
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { billPartyName, getBillingAccess } from "@/lib/billing";
import { billListWhere } from "@/lib/bill-list-query";
import { billTotals } from "@/lib/bill-document";
import { fileResponse } from "@/lib/bill-files";
import { BILL_STATUS_LABELS, BILL_TYPE_LABELS, COMPANY_LABELS, formatIndianDate } from "@/lib/billing-constants";

// A backup is meant to hold the whole list, but stay within one request
const MAX_ROWS = 20000;

const EMAIL_STATUS_LABELS = { sent: "Emailed", delayed: "Delivery delayed", failed: "Not delivered" } as const;

// GET /api/bills/export?type=&status=&emailed=&from=&to=&search= – the Billing
// List as an Excel file, with the same filters as the list on screen
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBillingAccess(user.id);
  if (!access || access.listCompanies.length === 0) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const searchParams = new URLSearchParams(new URL(request.url).searchParams);
  searchParams.set("view", "list");
  const filter = billListWhere(searchParams, access);
  if ("error" in filter) return NextResponse.json({ error: filter.error }, { status: filter.status });

  const total = await prisma.bill.count({ where: filter.where });
  if (total > MAX_ROWS) {
    return NextResponse.json(
      { error: `${total} bills match. Narrow the dates to ${MAX_ROWS} bills or fewer and download again.` },
      { status: 400 }
    );
  }

  const [bills, entities] = await Promise.all([
    prisma.bill.findMany({
      where: filter.where,
      include: {
        client: { select: { contactPerson: true, companyName: true, gstin: true, email: true } },
        createdBy: { select: { name: true } },
        amountEnteredBy: { select: { name: true } },
        reissuedFrom: { select: { billNumber: true } },
        reissuedAs: { select: { billNumber: true } },
      },
      orderBy: [{ billDate: "asc" }, { sequence: "asc" }],
    }),
    prisma.billingEntity.findMany({ select: { type: true, stateCode: true } }),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Billing List", { views: [{ state: "frozen", ySplit: 1 }] });
  const money = { numFmt: "#,##0.00" };
  sheet.columns = [
    { header: "Bill no.", key: "billNumber", width: 18 },
    { header: "Bill date", key: "billDate", width: 12 },
    { header: "Financial year", key: "financialYear", width: 10 },
    { header: "Company", key: "company", width: 10 },
    { header: "Series", key: "series", width: 30 },
    { header: "Client", key: "client", width: 32 },
    { header: "Contact person", key: "contactPerson", width: 22 },
    { header: "Client GSTIN", key: "gstin", width: 18 },
    { header: "Work done", key: "description", width: 50 },
    { header: "Work date", key: "workDate", width: 12 },
    { header: "Fee", key: "fee", width: 14, style: money },
    { header: "CGST", key: "cgst", width: 12, style: money },
    { header: "SGST", key: "sgst", width: 12, style: money },
    { header: "IGST", key: "igst", width: 12, style: money },
    { header: "Round off", key: "roundOff", width: 10, style: money },
    { header: "Total", key: "total", width: 14, style: money },
    { header: "Status", key: "status", width: 12 },
    { header: "Reissue", key: "reissue", width: 26 },
    { header: "Logged by", key: "createdBy", width: 18 },
    { header: "Amount by", key: "amountBy", width: 18 },
    { header: "Email", key: "email", width: 18 },
    { header: "Emailed to", key: "emailedTo", width: 30 },
    { header: "Emailed on", key: "emailedAt", width: 12 },
    { header: "Remark", key: "remark", width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  const sums = { fee: 0, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 0 };
  for (const bill of bills) {
    const fee = bill.amount !== null ? Number(bill.amount) : 0;
    const gstin = bill.client ? bill.client.gstin : bill.billToGstin;
    const stateCode = entities.find((e) => e.type === bill.type)?.stateCode || null;
    const totals = bill.type ? billTotals(bill.type, fee, stateCode, gstin || null) : null;
    // "GST @ 18%" (state code not set yet) is split like CGST + SGST
    const tax = (prefix: string) =>
      totals?.taxLines.filter((line) => line.label.startsWith(prefix)).reduce((sum, line) => sum + line.amount, 0) ?? 0;
    const single = tax("GST @") / 2;
    const row = {
      fee,
      cgst: tax("CGST") + single,
      sgst: tax("SGST") + single,
      igst: tax("IGST"),
      roundOff: totals?.roundOff ?? 0,
      total: totals?.total ?? fee,
    };
    if (bill.status === "approved") {
      for (const key of Object.keys(sums) as (keyof typeof sums)[]) sums[key] += row[key];
    }

    const added = sheet.addRow({
      billNumber: bill.billNumber,
      billDate: bill.billDate ? formatIndianDate(bill.billDate) : "",
      financialYear: bill.financialYear,
      company: COMPANY_LABELS[bill.company],
      series: bill.type ? BILL_TYPE_LABELS[bill.type] : "",
      client: billPartyName(bill) ?? "",
      contactPerson: bill.client?.contactPerson ?? "",
      gstin: gstin ?? "",
      description: bill.description,
      workDate: formatIndianDate(bill.workDate),
      ...row,
      status: BILL_STATUS_LABELS[bill.status],
      reissue: [
        bill.reissuedFrom?.billNumber && `Replaces ${bill.reissuedFrom.billNumber}`,
        bill.reissuedAs?.billNumber && `Reissued as ${bill.reissuedAs.billNumber}`,
      ]
        .filter(Boolean)
        .join("; "),
      createdBy: bill.createdBy.name,
      amountBy: bill.amountEnteredBy?.name ?? "",
      email: bill.emailStatus ? EMAIL_STATUS_LABELS[bill.emailStatus] : "Not emailed",
      emailedTo: bill.emailedTo ?? "",
      emailedAt: bill.emailedAt ? formatIndianDate(bill.emailedAt) : "",
      remark: bill.remark ?? "",
    });
    added.alignment = { vertical: "top", wrapText: true };
    if (bill.status === "cancelled") added.font = { color: { argb: "FF999999" }, strike: true };
  }

  if (bills.length > 0) {
    sheet.addRow([]);
    const totalRow = sheet.addRow({ description: "Total of approved bills", ...sums });
    totalRow.font = { bold: true };
  }

  const filters = workbook.addWorksheet("Filters");
  filters.columns = [
    { header: "Filter", key: "name", width: 18 },
    { header: "Value", key: "value", width: 40 },
  ];
  filters.getRow(1).font = { bold: true };
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  const emailed = searchParams.get("emailed");
  filters.addRows([
    { name: "Downloaded on", value: formatIndianDate(new Date(), "medium") },
    { name: "Downloaded by", value: user.name },
    { name: "Series", value: type && type !== "all" && type in BILL_TYPE_LABELS ? BILL_TYPE_LABELS[type as keyof typeof BILL_TYPE_LABELS] : "All series" },
    { name: "Bill date from", value: searchParams.get("from") || "—" },
    { name: "Bill date to", value: searchParams.get("to") || "—" },
    { name: "Status", value: status === "approved" ? "Approved" : status === "cancelled" ? "Cancelled" : "Approved and cancelled" },
    {
      name: "Email",
      value:
        emailed === "yes" ? "Emailed to party" : emailed === "failed" ? "Not delivered" : emailed === "no" ? "Not emailed yet" : "Emailed or not",
    },
    { name: "Search", value: searchParams.get("search") || "—" },
    { name: "Bills", value: bills.length },
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return fileResponse(new Uint8Array(buffer as ArrayBuffer), "xlsx", `Billing-List-${stamp}.xlsx`);
}

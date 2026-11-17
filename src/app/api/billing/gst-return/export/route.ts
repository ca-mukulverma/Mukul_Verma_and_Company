import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import { fileResponse } from "@/lib/bill-files";
import { formatIndianDate } from "@/lib/billing-constants";
import { canUseGstReturn, gstReturnRow, gstReturnRowSelect, mvcStateCode } from "@/lib/gst-return";
import { MONTH_KEY_PATTERN, monthDate, monthLabel } from "@/lib/gst-return-number";

// GET /api/billing/gst-return/export?month=YYYY-MM – the GST return register
// of a month as Excel, to enter in GSTR-1: GST return number, date, party,
// GSTIN, place of supply, taxable value and tax. Cancelled bills are listed
// last, marked, and left out of the totals.
export async function GET(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getBillingAccess(user.id);
  if (!access || !canUseGstReturn(access)) {
    return NextResponse.json({ error: "Only the MVC billing manager and Admin can use the GST return" }, { status: 403 });
  }
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH_KEY_PATTERN.test(month)) return NextResponse.json({ error: "Choose the return month" }, { status: 400 });

  const [bills, stateCode] = await Promise.all([
    prisma.bill.findMany({
      where: { gstReturnMonth: monthDate(month) },
      select: gstReturnRowSelect,
      orderBy: { gstReturnSequence: "asc" },
    }),
    mvcStateCode(),
  ]);
  const rows = bills.map((bill) => gstReturnRow(bill, stateCode));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("GST return", { views: [{ state: "frozen", ySplit: 1 }] });
  const money = { numFmt: "#,##0.00" };
  sheet.columns = [
    { header: "GST return no.", key: "gstReturnNumber", width: 16 },
    { header: "Invoice date", key: "billDate", width: 12 },
    { header: "Party", key: "party", width: 34 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "B2B / B2C", key: "kind", width: 10 },
    { header: "Place of supply", key: "placeOfSupply", width: 20 },
    { header: "Taxable value", key: "taxable", width: 14, style: money },
    { header: "CGST", key: "cgst", width: 12, style: money },
    { header: "SGST", key: "sgst", width: 12, style: money },
    { header: "IGST", key: "igst", width: 12, style: money },
    { header: "Invoice value", key: "total", width: 14, style: money },
    { header: "Status", key: "status", width: 11 },
    { header: "Work done", key: "description", width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };

  const sums = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  // Cancelled bills after the others, so the list to enter comes first
  const ordered = [...rows.filter((r) => r.status !== "cancelled"), ...rows.filter((r) => r.status === "cancelled")];
  for (const row of ordered) {
    const cancelled = row.status === "cancelled";
    if (!cancelled) for (const key of Object.keys(sums) as (keyof typeof sums)[]) sums[key] += row[key];
    const added = sheet.addRow({
      gstReturnNumber: row.gstReturnNumber,
      billDate: row.billDate ? formatIndianDate(row.billDate) : "",
      party: row.party,
      gstin: row.gstin ?? "",
      kind: row.gstin ? "B2B" : "B2C",
      placeOfSupply: row.placeOfSupply ?? "",
      taxable: row.taxable,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      total: row.total,
      status: cancelled ? "Cancelled" : "",
      description: row.description,
    });
    added.alignment = { vertical: "top", wrapText: true };
    if (cancelled) added.font = { color: { argb: "FF999999" }, strike: true };
  }
  if (rows.length > 0) {
    sheet.addRow([]);
    const totalRow = sheet.addRow({ party: "Total (cancelled bills left out)", ...sums });
    totalRow.font = { bold: true };
  }

  const info = workbook.addWorksheet("About");
  info.columns = [
    { header: "", key: "name", width: 20 },
    { header: "", key: "value", width: 50 },
  ];
  info.addRows([
    { name: "Return month", value: monthLabel(month) },
    { name: "Downloaded on", value: formatIndianDate(new Date(), "medium") },
    { name: "Downloaded by", value: user.name },
    { name: "Bills", value: rows.length },
    { name: "Note", value: "GST return numbers are used only in the GST return, not in Tally or on the bills." },
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  return fileResponse(new Uint8Array(buffer as ArrayBuffer), "xlsx", `GST-Return-${month}.xlsx`);
}

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { adminOnly, debtorsUser, salesLines } from "@/lib/tally-debtors";
import { parseSalesParams } from "@/lib/sales-params";
import { shortDate } from "@/lib/tally-sales";

export const dynamic = "force-dynamic";

// GET /api/sales/export?… (as /api/sales) – Admin: every sales line of the
// period and of the same period a year before, as Excel
export async function GET(request: Request) {
  const user = await debtorsUser();
  if (!user || user.role !== "ADMIN") return adminOnly();
  const parsed = parseSalesParams(new URL(request.url).searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { period, entities } = parsed;
  const { now, before } = await salesLines(entities, period);

  const book = new ExcelJS.Workbook();
  const sheet = (title: string, rows: typeof now) => {
    const ws = book.addWorksheet(title);
    ws.columns = [
      { header: "Firm", key: "firm", width: 8 },
      { header: "Date", key: "date", width: 11 },
      { header: "Vch Type", key: "t", width: 22 },
      { header: "Vch No.", key: "n", width: 16 },
      { header: "Party", key: "p", width: 34 },
      { header: "Party's group", key: "partyGroup", width: 24 },
      { header: "Income ledger", key: "l", width: 34 },
      { header: "Income group", key: "group", width: 22 },
      { header: "Amount", key: "a", width: 14, style: { numFmt: "#,##,##0.00;-#,##,##0.00" } },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow({ ...r, date: shortDate(r.d) });
    const total = ws.addRow({ p: "Total", a: rows.reduce((s, r) => s + r.a, 0) });
    total.font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  sheet(`${shortDate(period.from)} to ${shortDate(period.to)}`.slice(0, 31), now);
  sheet(`${shortDate(period.lyFrom)} to ${shortDate(period.lyTo)}`.slice(0, 31), before);
  const body = Buffer.from(await book.xlsx.writeBuffer());
  const name = `Sales ${period.from} to ${period.to} with year before.xlsx`;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

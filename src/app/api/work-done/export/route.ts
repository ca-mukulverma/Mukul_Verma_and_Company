import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { authOptions, getSessionUser } from "@/lib/auth";
import { fileResponse } from "@/lib/bill-files";
import { COMPANY_LABELS } from "@/lib/billing-constants";
import { getWorkDone, parseWorkDoneFilter, seesAllWork, WORK_SOURCE_LABELS } from "@/lib/work-done";

// GET /api/work-done/export – the Work Done list as an Excel file, with the
// same filters as on screen: every row, and a sheet with each person's count
export async function GET(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = parseWorkDoneFilter(new URL(request.url).searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const seesAll = await seesAllWork(user);
  const filter = { ...parsed, userId: seesAll ? parsed.userId : user.id };

  const { rows, byStaff, tooMany } = await getWorkDone(filter, user.id);
  if (tooMany) {
    return NextResponse.json({ error: "Too much work in these dates. Choose shorter dates and download again." }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MV Company";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Work Done", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Done by", key: "doneBy", width: 28 },
    { header: "Client", key: "client", width: 32 },
    { header: "Work", key: "work", width: 50 },
    { header: "Firm", key: "company", width: 8 },
    { header: "Source", key: "source", width: 14 },
    { header: "Status", key: "status", width: 24 },
    { header: "Note", key: "note", width: 30 },
  ];
  for (const row of rows) {
    const [y, m, d] = row.date.split("-").map(Number);
    sheet.addRow({
      date: new Date(Date.UTC(y, m - 1, d)),
      doneBy: row.doneBy.map((p) => p.name).join(", "),
      client: row.client ?? "",
      work: row.work,
      company: COMPANY_LABELS[row.company],
      source: WORK_SOURCE_LABELS[row.source],
      status: row.status,
      note: row.note ?? "",
    });
  }
  sheet.getColumn("date").numFmt = "dd-mm-yyyy";
  sheet.getColumn("work").alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: "A1", to: "H1" };

  const summary = workbook.addWorksheet("By staff", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    { header: "Staff", key: "name", width: 28 },
    { header: "Tasks", key: "task", width: 10 },
    { header: "Logged work", key: "logged", width: 14 },
    { header: "Compliance", key: "compliance", width: 12 },
    { header: "Total", key: "total", width: 10 },
  ];
  byStaff.forEach((person) => summary.addRow(person));
  summary.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return fileResponse(Buffer.from(buffer), "xlsx", `Work Done ${filter.from} to ${filter.to}.xlsx`);
}

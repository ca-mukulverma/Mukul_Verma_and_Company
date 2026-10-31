import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { clientCache, dashboardCache } from "@/lib/cache";
import { checkTaskRows, importTaskRows, readTaskRows, TaskImportFileError } from "@/lib/task-transfer";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// POST /api/tasks/import – form data: file (.xlsx from Export tasks), mode,
// allPending and clearDueDates ("true" to apply) (Admin, Partner)
//   mode=preview: check every row and report, nothing is saved
//   mode=import:  add the rows that pass every check as new tasks
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (user?.role !== "ADMIN" && user?.role !== "PARTNER") {
    return NextResponse.json({ error: "Only administrators and partners can import tasks" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "import" ? "import" : "preview";
  const options = { allPending: form.get("allPending") === "true", clearDueDates: form.get("clearDueDates") === "true" };
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB" }, { status: 400 });

  try {
    const rows = await checkTaskRows(await readTaskRows(await file.arrayBuffer()), options);
    if (rows.length === 0) return NextResponse.json({ error: "No tasks were found in the file" }, { status: 400 });

    const summary = {
      total: rows.length,
      ready: rows.filter((r) => r.task && !r.duplicate).length,
      errors: rows.filter((r) => r.errors.length > 0).length,
      duplicates: rows.filter((r) => r.task && r.duplicate).length,
      warnings: rows.filter((r) => r.task && !r.duplicate && r.warnings.length > 0).length,
    };

    if (mode === "preview") {
      // Only the rows worth showing, to keep the response small
      const problems = rows
        .filter((r) => r.errors.length || r.duplicate || r.warnings.length)
        .map(({ row, data, errors, warnings, duplicate }) => ({ row, title: data.title, errors, warnings, duplicate }));
      return NextResponse.json({ summary, problems });
    }

    const created = await importTaskRows(rows, user.id);
    await Promise.all([dashboardCache.invalidate("*"), clientCache.invalidate("*")]);
    return NextResponse.json({ summary, created });
  } catch (error) {
    if (error instanceof TaskImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

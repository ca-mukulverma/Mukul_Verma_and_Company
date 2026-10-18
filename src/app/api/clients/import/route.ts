import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { clientCache } from "@/lib/cache";
import {
  buildClientTemplate,
  checkClientRows,
  ImportFileError,
  importClientRows,
  readClientRows,
} from "@/lib/client-import";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

// GET /api/clients/import – the Excel template to fill in (Admin)
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only administrators can import clients" }, { status: 403 });
  }
  const file = await buildClientTemplate();
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Client-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

// POST /api/clients/import – form data: file (.xlsx) and mode
//   mode=preview: check every row and report, nothing is saved
//   mode=import:  create the rows that pass every check
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Only administrators can import clients" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "import" ? "import" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 2 MB" }, { status: 400 });

  try {
    const rows = await checkClientRows(await readClientRows(await file.arrayBuffer()));
    if (rows.length === 0) return NextResponse.json({ error: "No clients were found in the file" }, { status: 400 });

    const summary = {
      total: rows.length,
      ready: rows.filter((r) => r.errors.length === 0 && !r.duplicate).length,
      errors: rows.filter((r) => r.errors.length > 0).length,
      duplicates: rows.filter((r) => r.errors.length === 0 && r.duplicate).length,
    };

    if (mode === "preview") return NextResponse.json({ summary, rows });

    const created = await importClientRows(rows, admin.id);
    await clientCache.invalidate("*");
    return NextResponse.json({ summary, created });
  } catch (error) {
    if (error instanceof ImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

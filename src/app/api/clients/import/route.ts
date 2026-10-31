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
import { checkClientExtras, extrasSummary } from "@/lib/client-extras";

// Requests to Vercel functions are limited to 4.5 MB
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Admins and partners can add clients
async function requireClientCreator() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" || user?.role === "PARTNER" ? user : null;
}

// GET /api/clients/import – the Excel template to fill in (Admin, Partner)
export async function GET() {
  if (!(await requireClientCreator())) {
    return NextResponse.json({ error: "Only administrators and partners can import clients" }, { status: 403 });
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
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const user = await requireClientCreator();
  if (!user) {
    return NextResponse.json({ error: "Only administrators and partners can import clients" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "import" ? "import" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 4 MB" }, { status: 400 });

  try {
    const buffer = await file.arrayBuffer();
    const rows = await checkClientRows(await readClientRows(buffer));
    if (rows.length === 0) return NextResponse.json({ error: "No clients were found in the file" }, { status: 400 });

    const summary = {
      total: rows.length,
      ready: rows.filter((r) => r.errors.length === 0 && !r.duplicate).length,
      errors: rows.filter((r) => r.errors.length > 0).length,
      duplicates: rows.filter((r) => r.errors.length === 0 && r.duplicate).length,
    };

    // Logins, compliance setup and payments, when the file is a client export
    const extras = await checkClientExtras(buffer, rows);

    if (mode === "preview") return NextResponse.json({ summary, rows, extras: extrasSummary(extras) });

    const created = await importClientRows(rows, user.id, extras);
    await clientCache.invalidate("*");
    return NextResponse.json({ summary, created });
  } catch (error) {
    if (error instanceof ImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

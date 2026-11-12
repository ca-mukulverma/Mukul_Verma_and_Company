import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";
import { fileResponse } from "@/lib/bill-files";
import { buildWorkTemplate, readWorkFile, WorkImportFileError } from "@/lib/work-log-excel";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// GET /api/bills/import – the Excel sheet to log work in: drop-downs for the
// company and the client (with "Other" for a party not saved). Anyone who can
// log work can download it.
export async function GET() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getBillingAccess(user.id))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const buffer = await buildWorkTemplate(user.name ?? "");
  const stamp = new Date().toISOString().slice(0, 10);
  return fileResponse(new Uint8Array(buffer), "xlsx", `Log-work-${stamp}.xlsx`);
}

// POST /api/bills/import – form data: file (the filled sheet). Returns the
// rows read, with the clients found and any problems; nothing is saved here.
// The rows go into the Log work form to be checked and logged.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getBillingAccess(user.id))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB" }, { status: 400 });

  try {
    return NextResponse.json({ rows: await readWorkFile(await file.arrayBuffer()) });
  } catch (error) {
    if (error instanceof WorkImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

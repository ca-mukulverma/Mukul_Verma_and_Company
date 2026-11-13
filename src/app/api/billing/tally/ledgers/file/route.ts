import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { clientCache } from "@/lib/cache";
import { fileResponse } from "@/lib/bill-files";
import { ImportFileError } from "@/lib/client-import";
import { canSetTallyLedger } from "@/lib/connectors";
import { applyLedgerRows, buildLedgerFile, checkLedgerFile } from "@/lib/tally-ledger-file";

export const maxDuration = 60;

// Requests to Vercel functions are limited to 4.5 MB
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const FORBIDDEN = { error: "Only the billing manager or Admin can set Tally ledgers" };

async function ledgerUser() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  if (!user) return null;
  return (await canSetTallyLedger(user.id)) ? user : null;
}

// GET /api/billing/tally/ledgers/file – every client's Tally ledger as Excel
export async function GET() {
  const user = await ledgerUser();
  if (!user) return NextResponse.json(FORBIDDEN, { status: 403 });
  const file = await buildLedgerFile(user.name);
  return fileResponse(file, "xlsx", `Tally-ledgers-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// POST /api/billing/tally/ledgers/file – form data: file (.xlsx) and mode
//   mode=preview: compare every row with the ledger now; nothing is saved
//   mode=save:    save the changed ledgers
//   confirmUnchanged=true: also mark unchanged "to be set" clients as checked
export async function POST(request: NextRequest) {
  const user = await ledgerUser();
  if (!user) return NextResponse.json(FORBIDDEN, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "save" ? "save" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 4 MB" }, { status: 400 });

  try {
    const rows = await checkLedgerFile(await file.arrayBuffer());
    if (rows.length === 0) return NextResponse.json({ error: "No clients were found in the file" }, { status: 400 });
    const count = (status: string) => rows.filter((r) => r.status === status).length;
    const summary = {
      total: rows.length,
      change: count("change"),
      confirm: count("confirm"),
      same: count("same"),
      error: count("error"),
      warnings: rows.filter((r) => r.status !== "error" && r.warnings.length).length,
    };
    if (mode === "preview") {
      // Unchanged rows are only counted
      return NextResponse.json({ summary, rows: rows.filter((r) => r.status !== "same") });
    }
    const result = await applyLedgerRows(rows, user.id, form.get("confirmUnchanged") === "true");
    await clientCache.invalidate("*");
    return NextResponse.json({ summary, ...result });
  } catch (error) {
    if (error instanceof ImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

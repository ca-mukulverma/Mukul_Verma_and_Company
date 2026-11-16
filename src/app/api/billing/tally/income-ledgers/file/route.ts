import { NextRequest, NextResponse } from "next/server";
import { ImportFileError } from "@/lib/client-import";
import { importIncomeLedgers } from "@/lib/tally-income-ledgers";
import { forbidden, incomeLedgerAccess } from "@/lib/tally-income-ledgers-api";

export const maxDuration = 60;

// Requests to Vercel functions are limited to 4.5 MB
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// POST /api/billing/tally/income-ledgers/file – form data: file (.xlsx), the
// mapping sheet or any sheet with a "Tally income ledger" column. Adds new
// ledgers and updates group and "show"; nothing is deleted.
export async function POST(request: NextRequest) {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 4 MB" }, { status: 400 });
  try {
    return NextResponse.json(await importIncomeLedgers(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

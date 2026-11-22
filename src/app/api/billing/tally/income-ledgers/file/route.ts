import { NextRequest, NextResponse } from "next/server";
import { ImportFileError } from "@/lib/client-import";
import { importIncomeLedgers } from "@/lib/tally-income-ledgers";
import { firmSchema, forbidden, incomeLedgerAccess, ledgerFirms } from "@/lib/tally-income-ledgers-api";

export const maxDuration = 60;

// Requests to Vercel functions are limited to 4.5 MB
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// POST /api/billing/tally/income-ledgers/file – form data: entity (MVC /
// BEDGE: whose list) and file (.xlsx), the mapping sheet or any sheet with a
// "Tally income ledger" column. Adds new ledgers to that firm's list and
// updates group and "show"; nothing is deleted.
export async function POST(request: NextRequest) {
  const access = await incomeLedgerAccess();
  if (!access) return forbidden();
  const form = await request.formData();
  const entity = firmSchema.safeParse(form.get("entity") ?? "MVC");
  if (!entity.success) return NextResponse.json({ error: "Choose MVC or B Edge" }, { status: 400 });
  if (!ledgerFirms(access).includes(entity.data)) return forbidden();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the Excel file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 4 MB" }, { status: 400 });
  try {
    return NextResponse.json(await importIncomeLedgers(entity.data, await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

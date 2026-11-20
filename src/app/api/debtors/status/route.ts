import { NextResponse } from "next/server";
import { debtorsUser, notAllowed, syncStatus } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

// GET /api/debtors/status – when the Tally data was read, whether a refresh
// is waiting, when the Tally PC last checked in. Redis only (asked every few
// seconds while a refresh runs, so it must not wake the database).
export async function GET() {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  return NextResponse.json(await syncStatus());
}

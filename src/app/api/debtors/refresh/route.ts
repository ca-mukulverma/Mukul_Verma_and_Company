import { NextResponse } from "next/server";
import { askRefresh, debtorsUser, notAllowed, syncStatus } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

// POST /api/debtors/refresh – "Refresh now": the Tally PC picks this up within
// 30 seconds and sends the debtors again. Redis only.
export async function POST() {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const status = await syncStatus();
  if (!status.connected) return NextResponse.json({ error: "No Tally PC is connected yet. Admin connects it from Debtors on the Tally PC." }, { status: 409 });
  // One request is enough while one is waiting
  if (!status.refresh) {
    try {
      await askRefresh(user.name);
    } catch {
      return NextResponse.json({ error: "Could not ask the Tally PC just now. Try again in a minute." }, { status: 503 });
    }
  }
  return NextResponse.json(await syncStatus());
}

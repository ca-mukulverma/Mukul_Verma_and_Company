import { NextResponse } from "next/server";
import { z } from "zod";
import { connectSyncPc, debtorsUser, disconnectSyncPc } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

const schema = z.object({ company: z.string().trim().min(1).max(100) });

// POST /api/debtors/connect – Admin, on the Tally PC: makes the PC's key. The
// page hands it straight to the Tally extension; it is never shown, and only
// its hash is kept. A new key stops the old one at once.
export async function POST(request: Request) {
  const user = await debtorsUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Only Admin connects the Tally PC" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the company name as in Tally" }, { status: 400 });
  const key = await connectSyncPc(parsed.data.company, user.name);
  return NextResponse.json({ key, company: parsed.data.company });
}

// DELETE /api/debtors/connect – Admin: the Tally PC stops sending (its key no
// longer works). The debtors already here stay.
export async function DELETE() {
  const user = await debtorsUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Only Admin disconnects the Tally PC" }, { status: 403 });
  await disconnectSyncPc();
  return NextResponse.json({ ok: true });
}

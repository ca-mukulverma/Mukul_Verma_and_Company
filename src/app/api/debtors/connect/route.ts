import { NextResponse } from "next/server";
import { z } from "zod";
import { connectSyncPc, debtorsUser, disconnectSyncPc, entityParam } from "@/lib/tally-debtors";

export const dynamic = "force-dynamic";

const schema = z.object({ entity: entityParam, company: z.string().trim().min(1).max(100) });

// POST /api/debtors/connect { entity, company } – Admin, on that firm's Tally
// PC: makes the PC's key for the firm (MVC or B Edge). The page hands it
// straight to the Tally extension; it is never shown, and only its hash is
// kept. A new key stops the firm's old one at once.
export async function POST(request: Request) {
  const user = await debtorsUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Only Admin connects a Tally PC" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose MVC or B Edge and enter the company name as in Tally" }, { status: 400 });
  const key = await connectSyncPc(parsed.data.entity, parsed.data.company, user.name);
  return NextResponse.json({ key, entity: parsed.data.entity, company: parsed.data.company });
}

// DELETE /api/debtors/connect?entity= – Admin: that firm's Tally PC stops
// sending (its key no longer works). The debtors already here stay.
export async function DELETE(request: Request) {
  const user = await debtorsUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Only Admin disconnects a Tally PC" }, { status: 403 });
  const entity = entityParam.safeParse(new URL(request.url).searchParams.get("entity"));
  if (!entity.success) return NextResponse.json({ error: "Choose MVC or B Edge" }, { status: 400 });
  await disconnectSyncPc(entity.data);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { ackDeskItems } from "@/lib/wa-intake";

export const dynamic = "force-dynamic";

// POST /api/desk/files/ack – { ids } the Desk has saved. The R2 copies are
// deleted now; the database learns it at the next WhatsApp batch (no wake-up).
export async function POST(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : [];
  return NextResponse.json({ ok: true, removed: await ackDeskItems(who.code, ids) });
}

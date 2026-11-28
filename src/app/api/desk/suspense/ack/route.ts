import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { ackAnswers } from "@/lib/desk-links";

export const dynamic = "force-dynamic";

// POST /api/desk/suspense/ack – { refs } the Desk has saved: forgotten here and no longer shown to the client.
export async function POST(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const refs = Array.isArray(b.refs) ? b.refs.map(String).filter((r: string) => /^S\d{1,9}$/.test(r)).slice(0, 300) : [];
  return NextResponse.json({ ok: true, removed: await ackAnswers(who.code, refs) });
}

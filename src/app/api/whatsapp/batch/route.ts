import { NextResponse } from "next/server";
import { IncomingMessage, listenerFromRequest, saveBatch } from "@/lib/wa-intake";

export const dynamic = "force-dynamic";

const MAX = 500;

// POST /api/whatsapp/batch – the listener sends the messages it collected
// (every 30 minutes 11:00–20:00 IST, once after 20:00 with endOfDay: true).
// One call wakes the database at most once; alerts and the evening summary
// run inside it (docs/WHATSAPP_INTAKE.md).
export async function POST(request: Request) {
  if (!(await listenerFromRequest(request))) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const list = Array.isArray(b?.messages) ? (b.messages as IncomingMessage[]) : null;
  if (!list) return NextResponse.json({ error: "Send { messages: [...] }" }, { status: 400 });
  if (list.length > MAX) return NextResponse.json({ error: `At most ${MAX} messages per call` }, { status: 400 });
  const ok = list.filter(
    (m) => m && typeof m.waId === "string" && typeof m.groupJid === "string" && typeof m.senderPhone === "string" &&
      typeof m.sentAt === "string" && !Number.isNaN(Date.parse(m.sentAt))
  );
  const res = await saveBatch(ok, !!b.endOfDay);
  return NextResponse.json({ ...res, skipped: list.length - ok.length });
}

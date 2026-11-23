import { NextResponse } from "next/server";
import { deskFromRequest } from "@/lib/desk";
import { deskItems } from "@/lib/wa-intake";

export const dynamic = "force-dynamic";

// GET /api/desk/files – WhatsApp files and texts waiting for this client's
// Desk, with 15-minute download links. Served from Redis: no database call.
export async function GET(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  return NextResponse.json({ items: await deskItems(who.code), serverTime: new Date().toISOString() });
}

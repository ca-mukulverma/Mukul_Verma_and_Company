import { NextRequest, NextResponse } from "next/server";
import { saveAnswers } from "@/lib/desk-links";

export const dynamic = "force-dynamic";

// POST /api/public/suspense/<token> – the client's answers from the phone page (no sign-in: the link is the key).
// { answers: [{ref, nature, ledger, note}] }
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const text = await request.text();
  if (text.length > 256 * 1024) return NextResponse.json({ error: "Too much at once" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  const r = await saveAnswers(token, body);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, saved: r.saved });
}

import { NextResponse } from "next/server";
import { checkReport, deskFromRequest, MAX_REPORT_BYTES, saveReport, type DeskReportBody } from "@/lib/desk";

export const dynamic = "force-dynamic";

// POST /api/desk/report – the day's report from the desktop software at a
// client (weekdays 7 PM IST). Sending the same day again replaces it.
export async function POST(request: Request) {
  const who = await deskFromRequest(request);
  if (!who) return NextResponse.json({ error: "Key not accepted" }, { status: 401 });
  const text = await request.text();
  if (text.length > MAX_REPORT_BYTES) return NextResponse.json({ error: "Report too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  const bad = checkReport(body);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  await saveReport(who, body as DeskReportBody);
  return NextResponse.json({ ok: true });
}

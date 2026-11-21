import { NextResponse } from "next/server";
import { adminOnly, debtorsUser, salesFor } from "@/lib/tally-debtors";
import { parseSalesParams } from "@/lib/sales-params";

export const dynamic = "force-dynamic";

// GET /api/sales?firm=MVC|BEDGE|ALL&period=day|week|month|quarter|fy|custom&date=&to=
// Admin: sales from each firm's Tally (income ledgers) for the period, against
// the same period a year before, with what made the change. docs/TALLY_DEBTORS.md
export async function GET(request: Request) {
  const user = await debtorsUser();
  if (!user || user.role !== "ADMIN") return adminOnly();
  const parsed = parseSalesParams(new URL(request.url).searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json(await salesFor(parsed.entities, parsed.period));
}

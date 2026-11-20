import { NextResponse } from "next/server";
import { debtorsUser, entityParam, notAllowed, recoveryFor } from "@/lib/tally-debtors";
import { istToday } from "@/lib/tally-debtors-shared";

export const dynamic = "force-dynamic";

// GET /api/debtors/recovery?entity=MVC|BEDGE&month=YYYY-MM – a firm's recovery
// for the month: dues, billed, received, TDS, recovery %, ageing, the last 12
// months, by Tally group, whom to chase, and what WhatsApp follow-ups brought
export async function GET(request: Request) {
  const user = await debtorsUser();
  if (!user) return notAllowed();
  const q = new URL(request.url).searchParams;
  const entity = entityParam.safeParse(q.get("entity"));
  const month = q.get("month") ?? istToday().slice(0, 7);
  if (!entity.success || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > istToday().slice(0, 7)) {
    return NextResponse.json({ error: "Choose MVC or B Edge and a month up to this one" }, { status: 400 });
  }
  return NextResponse.json(await recoveryFor(entity.data, month));
}

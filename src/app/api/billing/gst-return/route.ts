import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingAccess } from "@/lib/billing";
import {
  PUSHABLE_WHERE,
  canUseGstReturn,
  getGstReturnSeries,
  gstReturnRow,
  gstReturnRowSelect,
  mvcStateCode,
  pushToGstReturn,
  undoGstReturnPush,
} from "@/lib/gst-return";
import { MONTH_KEY_PATTERN, monthDate, previousMonthKey } from "@/lib/gst-return-number";

const IST_OFFSET_MS = 330 * 60_000;
const MAX_IDS = 500;

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("push"),
    ids: z.array(z.string()).min(1).max(MAX_IDS),
    month: z.string().regex(MONTH_KEY_PATTERN, "Choose the return month"),
  }),
  z.object({ action: z.literal("undo"), ids: z.array(z.string()).min(1).max(MAX_IDS) }),
]);

async function accessFor() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await getBillingAccess(user.id);
  if (!access || !canUseGstReturn(access)) {
    return { error: NextResponse.json({ error: "Only the MVC billing manager and Admin can use the GST return" }, { status: 403 }) };
  }
  return { user, access };
}

// GET /api/billing/gst-return?view=pending|pushed&month=YYYY-MM
// pending: numbered GST bills not in the GST return yet, dated up to the end
// of the month. pushed: the GST return register of the month (cancelled
// bills stay, marked). docs/BILLING.md → GST return series
export async function GET(request: NextRequest) {
  const auth = await accessFor();
  if ("error" in auth) return auth.error;
  const params = new URL(request.url).searchParams;
  const view = params.get("view") === "pushed" ? "pushed" : "pending";
  const requested = params.get("month") ?? "";
  const month = MONTH_KEY_PATTERN.test(requested) ? requested : previousMonthKey();
  const [year, m] = month.split("-").map(Number);
  // The end of the month in India
  const monthEnd = new Date(Date.UTC(year, m, 1) - IST_OFFSET_MS);

  const [bills, stateCode, series] = await Promise.all([
    prisma.bill.findMany({
      where:
        view === "pending"
          ? { ...PUSHABLE_WHERE, billDate: { lt: monthEnd } }
          : { gstReturnMonth: monthDate(month) },
      select: gstReturnRowSelect,
      orderBy: view === "pending" ? [{ billDate: "asc" }, { sequence: "asc" }] : [{ gstReturnSequence: "asc" }],
      take: 2000,
    }),
    mvcStateCode(),
    getGstReturnSeries(month),
  ]);

  return NextResponse.json({
    view,
    month,
    isAdmin: auth.access.isAdmin,
    series,
    rows: bills.map((bill) => gstReturnRow(bill, stateCode)),
  });
}

// POST /api/billing/gst-return { action: "push", ids, month } – billing
// manager or Admin; { action: "undo", ids } – Admin only
export async function POST(request: NextRequest) {
  const auth = await accessFor();
  if ("error" in auth) return auth.error;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose the bills" }, { status: 400 });

  if (parsed.data.action === "push") {
    const result = await pushToGstReturn(parsed.data.ids, parsed.data.month, auth.user.id);
    return NextResponse.json(result);
  }

  if (!auth.access.isAdmin) {
    return NextResponse.json({ error: "Only Admin can take bills out of the GST return" }, { status: 403 });
  }
  const result = await undoGstReturnPush(parsed.data.ids, auth.user.id);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

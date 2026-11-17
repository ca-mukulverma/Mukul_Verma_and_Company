import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { getGstReturnSeries, setGstReturnNextNumber } from "@/lib/gst-return";
import { financialYearOfMonth, istMonthKey } from "@/lib/gst-return-number";

const updateSchema = z.object({
  financialYear: z.string().regex(/^\d{4}-\d{2}$/),
  nextNumber: z.number().int().min(1).max(99999999),
});

async function isAdmin() {
  return getSessionUser(await getServerSession(authOptions))?.role === "ADMIN";
}

// The years Admin can set: this financial year and the next (to be ready on 1 April)
function settableYears() {
  const current = financialYearOfMonth(istMonthKey());
  const start = Number(current.slice(0, 4)) + 1;
  return [current, `${start}-${String((start + 1) % 100).padStart(2, "0")}`];
}

// GET /api/billing/gst-return/series – next GST return number of this
// financial year and the next (Admin)
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Only Admin can manage the GST return series" }, { status: 403 });
  const years = settableYears();
  const series = await Promise.all(years.map((fy) => getGstReturnSeries(`${fy.slice(0, 4)}-04`)));
  return NextResponse.json({ series });
}

// PUT /api/billing/gst-return/series { financialYear, nextNumber } (Admin)
export async function PUT(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Only Admin can manage the GST return series" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a whole number of 1 or more" }, { status: 400 });
  const { financialYear, nextNumber } = parsed.data;
  if (!settableYears().includes(financialYear)) {
    return NextResponse.json({ error: "Only this financial year's and next year's series can be set" }, { status: 400 });
  }
  const result = await setGstReturnNextNumber(financialYear, nextNumber);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return GET();
}

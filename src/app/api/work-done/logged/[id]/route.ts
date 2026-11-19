import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { seesAllWork } from "@/lib/work-done";
import { correctLoggedWork, correctionSchema, getLoggedWork, serializeEntry } from "@/lib/work-correction";

type Params = { params: Promise<{ id: string }> };

// Admin and the partners who see everyone's work correct logged work
async function corrector() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await seesAllWork(user))) {
    return { error: NextResponse.json({ error: "Only Admin and the partners who see everyone's work can correct logged work" }, { status: 403 }) };
  }
  return { user };
}

// GET /api/work-done/logged/:id – the logged work, its corrections, and the staff to choose from
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await corrector();
  if ("error" in ctx) return ctx.error;
  const [entry, staff] = await Promise.all([
    getLoggedWork((await params).id),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!entry) return NextResponse.json({ error: "Logged work not found" }, { status: 404 });
  return NextResponse.json({ entry: serializeEntry(entry), staff });
}

// POST /api/work-done/logged/:id – correct it, with what and why, and on whose request
export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await corrector();
  if ("error" in ctx) return ctx.error;
  const parsed = correctionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const result = await correctLoggedWork((await params).id, parsed.data, { id: ctx.user.id, name: ctx.user.name || "Admin" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ entry: result.entry });
}

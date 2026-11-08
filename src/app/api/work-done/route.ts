import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkDone, parseWorkDoneFilter, seesAllWork } from "@/lib/work-done";

const PAGE_SIZE = 50;

// GET /api/work-done?from=&to=&user=&company=&source=&search=&page= – the Work
// Done list. Admin and the partners allowed see everyone's work; everyone else
// only their own. Read only when the page is opened or a filter changes.
export async function GET(request: NextRequest) {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const parsed = parseWorkDoneFilter(params);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const seesAll = await seesAllWork(user);
  const filter = { ...parsed, userId: seesAll ? parsed.userId : user.id };

  const [{ rows, byStaff, tooMany }, staff] = await Promise.all([
    getWorkDone(filter, user.id),
    // The people to filter by, for those who see everyone's work
    seesAll
      ? prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(params.get("page")) || 1), pages);

  return NextResponse.json({
    seesAll,
    from: filter.from,
    to: filter.to,
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: rows.length,
    page,
    pages,
    byStaff,
    staff,
    tooMany,
  });
}

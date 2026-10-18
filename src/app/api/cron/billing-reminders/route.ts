import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyBillingUsers } from "@/lib/billing";
import { countLabel } from "@/lib/bill-approvals";

// Daily job (see vercel.json). From the 25th of the month, reminds Admin about
// bills waiting for final approval: bills are dated on the day they are
// approved, so they should be approved before the month ends.
// Vercel Cron calls this with GET and "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric" }).format(new Date());
  if (Number(today) < 25) {
    return NextResponse.json({ message: "Reminders start on the 25th" });
  }

  const waiting = await prisma.bill.count({ where: { status: "manager_approved" } });
  if (waiting === 0) {
    return NextResponse.json({ message: "No bills waiting for final approval" });
  }

  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      notifyBillingUsers([admin.id], {
        title: "Bills awaiting final approval",
        content: `${countLabel(waiting)} ${waiting === 1 ? "is" : "are"} waiting for your final approval. Bills are dated on the day you approve them, so approve them before the month ends.`,
        sentById: admin.id,
      })
    )
  );

  return NextResponse.json({ message: `Reminded ${admins.length} admin(s) about ${countLabel(waiting)}` });
}

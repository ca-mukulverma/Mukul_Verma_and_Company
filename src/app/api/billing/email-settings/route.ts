import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BILLING_COMPANIES, BILLING_CONTACT_ADDRESS, BILLING_MAILBOXES, getBillEmailSettings } from "@/lib/bill-email";

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(75)
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address")
  .optional()
  .nullable()
  .transform((v) => v || null);

const settingsSchema = z.object({
  allowReplies: z.boolean(),
  replyTo: optionalEmail,
  copyTo: optionalEmail,
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

async function respond() {
  const settings = await getBillEmailSettings();
  return NextResponse.json({
    mailboxes: BILLING_COMPANIES.map((company) => {
      const { name, address, password, passwordVariable } = BILLING_MAILBOXES[company];
      return { company, name, address, passwordVariable, configured: !!password };
    }),
    contactAddress: BILLING_CONTACT_ADDRESS,
    allowReplies: settings.allowReplies,
    replyTo: settings.replyTo,
    copyTo: settings.copyTo,
    bounceCheckedAt: settings.bounceCheckedAt,
    bounceCheckError: settings.bounceCheckError,
  });
}

// GET /api/billing/email-settings – how bills are emailed to clients (Admin)
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can manage bill emails" }, { status: 403 });
  }
  return respond();
}

// PUT /api/billing/email-settings – save them (Admin)
export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can manage bill emails" }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  // The reply address only applies while replies are on
  const data = { ...parsed.data, replyTo: parsed.data.allowReplies ? parsed.data.replyTo : null };
  await prisma.billingEmailSetting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  return respond();
}

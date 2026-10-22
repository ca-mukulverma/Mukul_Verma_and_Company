import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BILL_TYPES, BillTypeValue } from "@/lib/billing-constants";

const optional = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

const entitySchema = z.object({
  type: z.enum(BILL_TYPES as [BillTypeValue, ...BillTypeValue[]]),
  name: z.string().trim().min(2, "Enter the name").max(100),
  address: optional(500),
  phone: optional(30),
  email: optional(75),
  pan: optional(10).refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), "PAN should look like ABCDE1234F"),
  gstin: optional(15).refine((v) => !v || /^\d{2}[A-Z0-9]{13}$/.test(v), "GSTIN should be 15 characters starting with the state code"),
  stateCode: optional(2).refine((v) => !v || /^\d{2}$/.test(v), "State code is 2 digits, e.g. 23"),
  sacCode: optional(10),
  bankName: optional(100),
  bankAccount: optional(30),
  bankIfsc: optional(11),
  bankBranch: optional(100),
  signatory: optional(100),
  footerNote: optional(500),
  tallyCompany: optional(100),
  tallyVoucherType: optional(50),
  tallySalesLedger: optional(100),
  tallyCgstLedger: optional(100),
  tallySgstLedger: optional(100),
  tallyIgstLedger: optional(100),
  tallyRoundOffLedger: optional(100),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = getSessionUser(session);
  return user?.role === "ADMIN" ? user : null;
}

// GET /api/billing/entities – the letterhead details of each bill type (Admin)
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can manage company profiles" }, { status: 403 });
  }
  const entities = await prisma.billingEntity.findMany();
  return NextResponse.json({ entities: entities.sort((a, b) => BILL_TYPES.indexOf(a.type) - BILL_TYPES.indexOf(b.type)) });
}

// PUT /api/billing/entities – save one profile (Admin)
export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only Admin can manage company profiles" }, { status: 403 });
  }
  const body = await request.json();
  const parsed = entitySchema.safeParse({
    ...body,
    pan: typeof body.pan === "string" ? body.pan.toUpperCase() : body.pan,
    gstin: typeof body.gstin === "string" ? body.gstin.toUpperCase() : body.gstin,
    bankIfsc: typeof body.bankIfsc === "string" ? body.bankIfsc.toUpperCase() : body.bankIfsc,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Invalid data" }, { status: 400 });
  }
  const { type, ...data } = parsed.data;
  // The GSTIN starts with the state code, so the two must agree
  if (data.gstin && data.stateCode && !data.gstin.startsWith(data.stateCode)) {
    return NextResponse.json({ error: "The GSTIN should start with the state code" }, { status: 400 });
  }
  const entity = await prisma.billingEntity.upsert({ where: { type }, update: data, create: { type, ...data } });
  return NextResponse.json(entity);
}

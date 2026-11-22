import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientPhones } from "@/lib/client-contacts";

// GET /api/clients/similar?name=&company=&phone=&email=&gstin=&pan= – before a
// client is added from Create Task: clients that look like the same one (same
// owner or company name, mobile, email, GSTIN or PAN), so it isn't added twice
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== "ADMIN" && session.user.role !== "PARTNER")) {
    return NextResponse.json({ error: "Only administrators and partners can add clients" }, { status: 403 });
  }
  const q = new URL(request.url).searchParams;
  const text = (k: string) => (q.get(k) ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const name = text("name");
  const company = text("company");
  const email = text("email");
  const gstin = text("gstin").replace(/\s/g, "");
  const pan = text("pan").replace(/\s/g, "");
  const digits = (q.get("phone") ?? "").replace(/\D/g, "").slice(-10);

  const clients = await prisma.client.findMany({
    select: { id: true, contactPerson: true, companyName: true, email: true, gstin: true, pan: true, phone: true, phones: true, isGuest: true },
  });
  const same = (a: string | null | undefined, b: string) => !!b && (a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === b;
  const matches = clients
    .map((c) => {
      const why: string[] = [];
      if (same(c.contactPerson, name) || same(c.companyName, name)) why.push("same name");
      if (company && (same(c.companyName, company) || same(c.contactPerson, company))) why.push("same company name");
      if (digits.length === 10 && clientPhones(c).some((p) => p.number.replace(/\D/g, "").endsWith(digits))) why.push("same mobile");
      if (same(c.email, email)) why.push("same email");
      if (gstin && (c.gstin ?? "").toLowerCase() === gstin) why.push("same GSTIN");
      if (pan && (c.pan ?? "").toLowerCase() === pan) why.push("same PAN");
      return { id: c.id, contactPerson: c.contactPerson, companyName: c.companyName, isGuest: c.isGuest, why: [...new Set(why)] };
    })
    .filter((m) => m.why.length > 0)
    .sort((a, b) => b.why.length - a.why.length)
    .slice(0, 5);
  return NextResponse.json({ matches });
}

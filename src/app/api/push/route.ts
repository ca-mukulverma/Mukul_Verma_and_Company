import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { basePrisma } from "@/lib/prisma";
import {
  countSubscriptions,
  getPublicKey,
  pushEnabled,
  removeSubscription,
  saveSubscription,
} from "@/lib/push";

export const dynamic = "force-dynamic";

async function currentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await basePrisma.user.findUnique({
    where: { email: session.user.email as string },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** GET /api/push → { enabled, publicKey, devices } */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ enabled: false, publicKey: null, devices: 0 });
  let devices = 0;
  try {
    devices = await countSubscriptions(userId);
  } catch (e) {
    console.error("[push] count failed", e);
  }
  return NextResponse.json({ enabled: true, publicKey: getPublicKey(), devices });
}

/** POST /api/push  body: PushSubscription JSON → save this device for the logged-in user */
export async function POST(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ error: "Push not configured" }, { status: 503 });

  try {
    const sub = await request.json();
    if (
      !sub?.endpoint ||
      typeof sub.endpoint !== "string" ||
      !sub.endpoint.startsWith("https://") ||
      !sub?.keys?.p256dh ||
      !sub?.keys?.auth
    ) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }
    await saveSubscription(userId, sub, request.headers.get("user-agent"));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push] subscribe failed", e);
    return NextResponse.json({ error: "Could not save subscription" }, { status: 500 });
  }
}

/** DELETE /api/push  body: { endpoint } → stop notifications on this device */
export async function DELETE(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { endpoint } = await request.json();
    if (endpoint) await removeSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push] unsubscribe failed", e);
    return NextResponse.json({ error: "Could not remove subscription" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionUser } from "@/lib/auth";
import { myAnnouncementIds, pushStatus } from "@/lib/whats-new-server";
import { ANNOUNCEMENTS } from "@/lib/whats-new";

// Which What's new cards are for me. Asked only when this device has a card
// it hasn't shown yet, or on the What's new page. Admins also get every card
// (to send its push) and which pushes have gone out.
export async function GET() {
  const user = getSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ids, pushes] = await Promise.all([
    myAnnouncementIds(user.id),
    user.role === "ADMIN" ? pushStatus() : Promise.resolve(undefined),
  ]);
  const all = user.role === "ADMIN" ? ANNOUNCEMENTS.map((a) => a.id) : undefined;
  return NextResponse.json({ ids, all, pushes });
}

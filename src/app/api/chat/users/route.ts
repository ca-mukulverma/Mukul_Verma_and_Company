import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { userCache } from "@/lib/cache";

// Key for tracking online users
const ONLINE_USERS_KEY = "online_users";

// The chat page polls this every 30 seconds while open. Online status comes
// live from Redis; the staff list itself rarely changes, so it is cached for a
// few minutes instead of being read from the database on every poll.
const STAFF_LIST_CACHE_KEY = "chat:active-staff";
const STAFF_LIST_TTL_SECONDS = 5 * 60;

type StaffRow = { id: string; name: string; role: string; avatar: string | null };

async function getActiveStaff(): Promise<StaffRow[]> {
  const cached = await userCache.get<StaffRow[]>(STAFF_LIST_CACHE_KEY);
  if (cached) return cached;

  const rows = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      role: true,
      avatar: true,
    }
  });
  await userCache.set(STAFF_LIST_CACHE_KEY, rows, { ttl: STAFF_LIST_TTL_SECONDS });
  return rows;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    // Active staff (cached briefly; see getActiveStaff)
    const dbUsers = await getActiveStaff();
    
    // Get online status from Redis
    const onlineStatus = await redis.hgetall(ONLINE_USERS_KEY);
    
    // Combine data
    const users = dbUsers.map(user => {
      const status = onlineStatus[user.id] 
        ? JSON.parse(onlineStatus[user.id])
        : { lastSeen: null };
        
      // Check if user has been active in the last 2 minutes
      const lastSeen = status.lastSeen ? new Date(status.lastSeen) : null;
      const isOnline = lastSeen && 
        ((new Date().getTime() - lastSeen.getTime()) < 2 * 60 * 1000);
      
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        avatar: user.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`,
        isOnline,
        lastSeen: status.lastSeen
      };
    });
    
    return NextResponse.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
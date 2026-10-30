import { NextResponse, NextRequest } from "next/server";
import { BillType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushForNotification } from "@/lib/web-push";
import { dashboardCache } from "@/lib/cache";
import { BILL_TYPE_LABELS, BILL_TYPES } from "@/lib/billing-constants";
import { billReturnData } from "@/lib/billing";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const dataType = searchParams.get('dataType') || 'full';

    // Create cache key based on data type and user ID (to avoid leaking data between users)
    const cacheKey = `${session.user.id}:${dataType}`;

    // Try to get from cache first
    const cachedData = await dashboardCache.get(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // For stats, we can cache longer since these don't change as frequently
    if (dataType === 'stats') {
      const [
        totalUsers,
        activeUsers,
        totalClients,
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        overdueTasks,
        newUsersThisMonth
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({
          where: { isActive: true }
        }),
        prisma.client.count(),
        prisma.task.count(),
        prisma.task.count({
          where: { status: "completed" }
        }),
        prisma.task.count({
          where: { status: "pending" }
        }),
        prisma.task.count({
          where: { status: "in_progress" }
        }),
        prisma.task.count({
          where: {
            dueDate: { lt: new Date() },
            status: { notIn: ["completed", "cancelled"] }
          }
        }),
        prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(new Date().setDate(1)) // First day of current month
            }
          }
        })
      ]);

      const statsData = {
        totalUsers,
        activeUsers,
        totalClients,
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        overdueTasks,
        newUsersThisMonth
      };

      // Cache the stats data for 5 minutes (300 seconds)
      await dashboardCache.set(cacheKey, statsData, { ttl: 300 });

      return NextResponse.json(statsData);
    }

    // For overview, cache for a shorter time as tasks might change more frequently
    if (dataType === 'overview') {
      // Fetch only tasks
      const highPriorityTasks = await prisma.task.findMany({
        where: { 
          priority: "high",
          status: { not: "completed" }
        },
        take: 5,
        orderBy: { dueDate: "asc" },
        include: {
          assignees: {
            include: {
              user: {
                select: { id: true, name: true }
              }
            }
          }
        }
      });

      const overviewData = {
        tasks: highPriorityTasks.map(task => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate?.toISOString() || null,
          assignees: task.assignees.map(a => ({
            id: a.user.id,
            name: a.user.name
          }))
        }))
      };

      // Cache the overview data for 2 minutes (120 seconds)
      await dashboardCache.set(cacheKey, overviewData, { ttl: 120 });

      return NextResponse.json(overviewData);
    }

    // For full data request, return everything
    // This is the original implementation
    const partners = await prisma.user.findMany({
      where: { role: "PARTNER" },
      select: { 
        id: true, 
        name: true, 
        avatar: true,
        canApproveBilling: true,
        canManageBedgeBilling: true,
        canEnterBillAmounts: true,
        canViewBillingList: true,
        billingListTypes: true,
      },
    });

    // Fetch staff without tasks - UPDATED QUERY
    const staffWithoutTasks = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: session.user.id }, // Exclude the current user
        // Remove the "role: { not: "ADMIN" }" filter to include admin users
        // This allows admins to be assigned tasks by other admins
        taskAssignments: {
          none: {}
        },
      },
      select: {
        id: true,
        name: true,
        avatar: true,
        role: true
      }
    });

    const [
      totalUsers,
      activeUsers,
      totalClients,
      totalTasks
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          isActive: true
        }
      }),
      prisma.client.count(),
      prisma.task.count({
        where: {
          status: {
            not: "completed"
          }
        }
      })
    ]);

    const [
      completedTasks,
      pendingTasks,
      inProgressTasks,
      overdueTasks,
      highPriorityTasks
    ] = await Promise.all([
      prisma.task.count({
        where: { status: "completed" }
      }),
      prisma.task.count({
        where: { status: "pending" }
      }),
      prisma.task.count({
        where: { status: "in_progress" }
      }),
      prisma.task.count({
        where: {
          status: { not: "completed" },
          dueDate: { lt: new Date() }
        }
      }),
      prisma.task.findMany({
        where: { 
          priority: "high",
          status: { not: "completed" }
        },
        take: 5,
        orderBy: { dueDate: "asc" },
        include: {
          assignees: {
            include: {
              user: {
                select: { id: true, name: true }
              }
            }
          }
        }
      })
    ]);

    // Fetch recent activities with filtering out login/logout actions
    const recentActivities = await prisma.activity.findMany({
      where: {
        action: {
          notIn: ["login", "logout"] // Exclude login and logout actions
        }
      },
      take: 20,
      orderBy: {
        createdAt: "desc"
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true
          }
        }
      }
    });

    // Transform activities for the frontend
    const transformedActivities = recentActivities.map(activity => ({
      id: activity.id,
      type: activity.type,
      user: {
        name: activity.user.name,
        role: activity.user.role,
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${activity.user.name}`
      },
      action: activity.action,
      target: activity.target,
      timestamp: activity.createdAt.toISOString()
    }));

    // Return the dashboard data
    const fullData = {
      stats: {
        totalUsers,
        activeUsers,
        totalClients,
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        overdueTasksCount: overdueTasks
      },
      tasks: highPriorityTasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate?.toISOString() || null,
        assignees: task.assignees.map(a => ({
          id: a.user.id,
          name: a.user.name
        }))
      })),
      recentActivities: transformedActivities,
      partners,
      staffWithoutTasks,
    };

    // Cache the full data for 1 minute (60 seconds)
    await dashboardCache.set(cacheKey, fullData, { ttl: 60 });

    return NextResponse.json(fullData);
  } catch (error) {
    console.error("Error in status route:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}

// Update billing approval status for partners
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Array of { id, canApproveBilling, canManageBedgeBilling?, canEnterBillAmounts?, canViewBillingList?,
  // billingListTypes? } – billingListTypes: the Billing Lists that partner sees, [] = all
  const { updates } = await request.json() as {
    updates: {
      id: string;
      canApproveBilling: boolean;
      canManageBedgeBilling?: boolean;
      canEnterBillAmounts?: boolean;
      canViewBillingList?: boolean;
      billingListTypes?: BillType[];
    }[];
  };
  if (updates.some((u) => u.billingListTypes?.some((t) => !(BILL_TYPES as string[]).includes(t)))) {
    return NextResponse.json({ error: "Unknown bill type" }, { status: 400 });
  }

  try {
    const updatePromises = updates.map(async (update) => {
      const before = await prisma.user.findUnique({
        where: { id: update.id },
        select: {
          canApproveBilling: true,
          canManageBedgeBilling: true,
          canEnterBillAmounts: true,
          canViewBillingList: true,
          billingListTypes: true,
        },
      });
      const updatedUser = await prisma.user.update({
        where: { id: update.id },
        data: {
          canApproveBilling: update.canApproveBilling,
          ...(update.canManageBedgeBilling !== undefined && {
            canManageBedgeBilling: update.canManageBedgeBilling,
          }),
          ...(update.canEnterBillAmounts !== undefined && {
            canEnterBillAmounts: update.canEnterBillAmounts,
          }),
          ...(update.canViewBillingList !== undefined && {
            canViewBillingList: update.canViewBillingList,
          }),
          ...(update.billingListTypes !== undefined && {
            billingListTypes: [...new Set(update.billingListTypes)],
          }),
        },
      });

      // Bills waiting for this partner's amount go back to the billing managers
      if (update.canEnterBillAmounts === false && before?.canEnterBillAmounts) {
        await prisma.$transaction(async (tx) => {
          const waiting = await tx.bill.findMany({
            where: { amountRequestedFromId: update.id, status: "awaiting_amount" },
            select: { id: true },
          });
          if (waiting.length === 0) return;
          const remark = `${updatedUser.name} can no longer enter amounts`;
          await tx.bill.updateMany({
            where: { id: { in: waiting.map((b) => b.id) }, status: "awaiting_amount" },
            data: { status: "draft", amountRequestedFromId: null, ...billReturnData("sent_back", remark, session.user.id) },
          });
          await tx.billEvent.createMany({
            data: waiting.map((b) => ({ billId: b.id, action: "sent_back", userId: session.user.id, remark })),
          });
        });
      }

      // Notify only about permissions that were just granted
      const granted: string[] = [];
      if (update.canApproveBilling && !before?.canApproveBilling) {
        granted.push("You have been made an MVC billing manager. You can now manage MVC bills from the Billing page and approve billing on dashboard and task pages.");
      }
      if (update.canManageBedgeBilling && !before?.canManageBedgeBilling) {
        granted.push("You have been made a B Edge billing manager. You can now manage B Edge bills from the Billing page.");
      }
      if (update.canEnterBillAmounts && !before?.canEnterBillAmounts) {
        granted.push("Billing managers can now send you bills to enter the amount. They appear under \"Awaiting my amount\" on the Billing page.");
      }
      const lists = (types: BillType[]) =>
        types.length && types.length < BILL_TYPES.length ? types.map((t) => BILL_TYPE_LABELS[t]).join(", ") : "MVC and B Edge (all bills)";
      const newTypes = update.billingListTypes ?? before?.billingListTypes ?? [];
      if (update.canViewBillingList && !before?.canViewBillingList) {
        granted.push(`You can now see the Billing List on the Billing page for ${lists(newTypes)}, download those bills and email them to clients.`);
      } else if (
        update.canViewBillingList &&
        update.billingListTypes !== undefined &&
        [...newTypes].sort().join() !== [...(before?.billingListTypes ?? [])].sort().join()
      ) {
        granted.push(`Your Billing List now shows: ${lists(newTypes)}.`);
      }
      for (const content of granted) {
        const notification = await prisma.notification.create({
          data: {
            title: "Permission Granted",
            content,
            sentById: session.user.id, // Admin who made the change
            sentToId: updatedUser.id, // Partner receiving the notification
          },
        });
        await sendPushForNotification(notification);
      }
    });
    await Promise.all(updatePromises);
    // The permissions page reads partners from the cached dashboard data
    await dashboardCache.invalidate("*").catch(() => undefined);
    return NextResponse.json({ message: "Permissions updated successfully" });
  } catch (error) {
    console.error("Failed to update permissions:", error);
    return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 });
  }
}
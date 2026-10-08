"use client";

import { useState, useEffect, Suspense } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Bell, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PushNotificationSettings } from "@/components/notifications/push-notification-settings";

// How many notifications to load at a time
const PAGE_SIZE = 50;

interface Notification {
  id: string;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  sentByName?: string;
}

function NotificationsContent() {
  useSession();
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);

  // Load one page of notifications (newest first); later pages are appended
  const loadNotifications = async (pageToLoad: number) => {
    try {
      if (pageToLoad === 1) setNotificationsLoading(true);
      else setLoadingMore(true);
      const response = await axios.get(
        `/api/notifications?limit=${PAGE_SIZE}&page=${pageToLoad}`
      );
      const { data, pagination } = response.data;
      setRecentNotifications((prev) => {
        if (pageToLoad === 1) return data;
        // Skip any that are already shown (new notifications shift the pages)
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...data.filter((n: Notification) => !seen.has(n.id))];
      });
      setPage(pageToLoad);
      setPageCount(pagination?.pages ?? 1);
      setTotal(pagination?.total ?? data.length);
    } catch (error: unknown) {
      console.error("Failed to load notifications:", error);
      toast.error("Failed to load notifications");
    } finally {
      setNotificationsLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadNotifications(1);
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  // Add this function to strip taskIds from content
  const stripTaskIdFromContent = (content: string): string => {
    // Replace all taskId patterns with empty string
    return content
      .replace(/\[taskId:\s*[a-f0-9-]+\]/g, "")
      .replace(/taskId:\s*[a-f0-9-]+/g, "")
      .replace(/\(taskId:\s*[a-f0-9-]+\)/g, "")
      .replace(/Task ID:\s*[a-f0-9-]+/gi, "")
      .trim();
  };

  return (
    <div className="grid gap-6">
      <PushNotificationSettings />

      {/* Recent Notifications */}
      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              {total > 0
                ? `Showing ${recentNotifications.length} of ${total} (kept for 90 days)`
                : "Notifications are kept for 90 days"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {notificationsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-3 p-3 border rounded-md">
                  <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                  <div className="space-y-2 flex-grow">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentNotifications.length > 0 ? (
            <div className="space-y-4 overflow-y-auto max-h-[60vh] pr-2">
              {recentNotifications.map((notification) => (
                <div 
                  key={notification.id}
                  className={`flex gap-3 p-3 border rounded-md ${!notification.isRead ? 'bg-muted/30' : ''}`}
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bell className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{notification.title}</p>
                      {!notification.isRead && (
                        <Badge variant="default" className="h-1.5 w-1.5 rounded-full p-0" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {notification.title === "New Task Assigned" ||
                       notification.title === "Task Status Updated" ||
                       notification.title === "New Comment on Task"
                        ? stripTaskIdFromContent(notification.content)
                        : notification.content}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(notification.createdAt)}
                      {notification.sentByName && ` · From: ${notification.sentByName}`}
                    </p>
                  </div>
                </div>
              ))}
              {page < pageCount && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => loadNotifications(page + 1)}
                    disabled={loadingMore}
                  >
                    {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Info className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-20" />
              <p className="text-muted-foreground">No notifications to display</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={
      <div className="grid gap-6">
        <Card>
          <Skeleton className="h-6 w-48 m-6" />
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </Card>
      </div>
    }>
      <NotificationsContent />
    </Suspense>
  );
}
"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bell, CheckCheck, MessageSquareReply, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActivePolling } from "@/hooks/use-active-polling";
import { cn } from "@/lib/utils";
import { notificationLink, notificationText } from "@/lib/notification-links";
import { QuickReply } from "@/components/tasks/quick-reply";
import { followsUpTasks } from "@/lib/task-views";

// How often the bell refreshes while the user is active. Push notifications
// still arrive instantly; this only refreshes the in-app list and badge.
const POLL_INTERVAL_MS = 60_000;
// Returning to the app refreshes the list, but not more often than this, so
// switching apps back and forth on a phone doesn't query the database each time.
const REFRESH_ON_RETURN_MIN_GAP_MS = 30_000;
// Guards against near-simultaneous fetches.
const MIN_FETCH_GAP_MS = 5_000;
// The bell holds unread notifications only; a read one leaves it (all of
// them stay under Settings → Notifications)
const BELL_SIZE = 20;

// Define notification types
export interface Notification {
  id: string;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: string | Date;
  sentById?: string;
  sentByName?: string;
  type?: "info" | "success" | "warning" | "error";
  taskId?: string;
}

interface NotificationContextProps {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  markAsRead: (id: string) => Promise<void>;
  // Clears every unread notification about one task
  markTaskAsRead: (taskId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

// Create context
const NotificationContext = createContext<NotificationContextProps>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,
  markAsRead: async () => {},
  markTaskAsRead: async () => {},
  markAllAsRead: async () => {},
  deleteNotification: async () => {},
  refreshNotifications: async () => {},
});

// Hook for consuming the notification context
export const useNotifications = () => useContext(NotificationContext);

// Provider component
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: keeps fetchNotifications stable, so the polling effect
  // below doesn't tear down and restart after every fetch.
  const lastFetchedRef = useRef<number>(0);
  const { status } = useSession();

  // From the server: the list holds only the latest few
  const [unreadCount, setUnreadCount] = useState(0);
  // The list as last rendered, for callbacks that must stay stable
  const notificationsRef = useRef<Notification[]>([]);
  notificationsRef.current = notifications;

  // Fetch notifications - stabilize with useCallback
  const fetchNotifications = useCallback(async (): Promise<void> => {
    // Prevent multiple near-simultaneous fetches
    const now = Date.now();
    if (now - lastFetchedRef.current < MIN_FETCH_GAP_MS) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      lastFetchedRef.current = now;
      
      const response = await axios.get(`/api/notifications?unreadOnly=true&limit=${BELL_SIZE}`);
      const data = response.data as { data: Notification[]; unreadCount?: number };
      setNotifications(data.data || []);
      setUnreadCount(data.unreadCount ?? (data.data || []).filter((n) => !n.isRead).length);
    } catch (err) {
      console.error("Failed to load notifications:", err);
      // Keep the notifications already shown. A failed poll is usually the phone
      // waking the app from the background (e.g. after tapping a push notification)
      // before its network is back, not an expired session, so don't send the user
      // to the login page; real sign-outs are handled by the middleware and AuthProvider.
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  // Mark a notification as read: it leaves the bell
  const markAsRead = useCallback(async (id: string) => {
    try {
      const wasUnread = notificationsRef.current.some((n) => n.id === id && !n.isRead);
      setNotifications((prev) => prev.filter((notification) => notification.id !== id));
      if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
      await axios.patch(`/api/notifications/${id}`, { isRead: true });
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
      toast.error("Failed to mark notification as read");
    }
  }, []);

  // Every unread notification about one task leaves the bell
  const markTaskAsRead = useCallback(async (taskId: string) => {
    try {
      const shown = notificationsRef.current.filter((n) => n.taskId === taskId && !n.isRead).length;
      setNotifications((prev) => prev.filter((n) => n.taskId !== taskId));
      const { data } = await axios.patch<{ count: number }>("/api/notifications", { taskId });
      setUnreadCount((count) => Math.max(0, count - Math.max(shown, data.count ?? 0)));
    } catch (err) {
      console.error("Failed to mark the task's notifications read:", err);
    }
  }, []);

  // Mark every notification read: the bell empties
  const markAllAsRead = useCallback(async () => {
    try {
      await axios.patch("/api/notifications");
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark notifications read:", err);
      toast.error("Failed to mark notifications read");
    }
  }, []);

  // Delete a notification - stabilized with useCallback
  const deleteNotification = useCallback(async (id: string) => {
    try {
      await axios.delete(`/api/notifications/${id}`);
      setNotifications(prev =>
        prev.filter(notification => notification.id !== id)
      );
      toast.success("Notification deleted");
    } catch (err) {
      console.error("Failed to delete notification:", err);
      toast.error("Failed to delete notification");
    }
  }, []);

  // Initial fetch and polling setup (only while signed in, e.g. not on the login page)
  useEffect(() => {
    if (status !== "authenticated") {
      setLoading(false);
      return;
    }

    // Initial fetch
    fetchNotifications();

    // Refresh when the app comes back to the foreground (e.g. after tapping a
    // push notification), unless it was refreshed moments ago
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastFetchedRef.current >= REFRESH_ON_RETURN_MIN_GAP_MS
      ) {
        fetchNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchNotifications, status]);

  // Poll while the app is in the foreground and the user is active; idle or
  // background tabs stop polling so the database can sleep
  useActivePolling(fetchNotifications, POLL_INTERVAL_MS, status === "authenticated");

  // Create a stable context value
  const contextValue = {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markTaskAsRead,
    markAllAsRead,
    deleteNotification,
    refreshNotifications: fetchNotifications,
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}

// The bell in the header: unread notifications only. Clicking one opens what
// it is about and takes it (and the task's other notifications) off the bell.
// Task notifications have Reply, to answer without leaving the page.
export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markTaskAsRead, markAllAsRead, loading } = useNotifications();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const router = useRouter();
  const canAskReply = followsUpTasks(session?.user);

  const dismiss = (notification: Notification) => {
    if (notification.taskId) markTaskAsRead(notification.taskId);
    else markAsRead(notification.id);
  };

  const handleNotificationClick = (notification: Notification) => {
    dismiss(notification);
    const link = notificationLink(notification);
    setOpen(false);
    if (link) router.push(link);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReplyingTo(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 rounded-full"
          title={unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center px-1 text-[10px]"
              variant="destructive"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,calc(100vw-32px))] p-0" align="end">
        <div className="flex items-center justify-between border-b p-3">
          <h3 className="font-medium">
            Notifications{unreadCount > 0 && <span className="ml-1 text-muted-foreground">({unreadCount})</span>}
          </h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAllAsRead()} className="h-7 text-xs">
              <CheckCheck className="mr-1 h-3.5 w-3.5" />Clear all
            </Button>
          )}
        </div>
        <ScrollArea className="h-[min(440px,65vh)]">
          {loading && notifications.length === 0 ? (
            <div className="space-y-3 p-4">
              {Array(3).fill(0).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">You&apos;re all caught up</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div key={notification.id} className="group relative">
                  <button
                    type="button"
                    className="flex w-full gap-2 p-3 pr-9 text-left transition-colors hover:bg-muted"
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        notification.title === "Reply needed" ? "bg-amber-500" : "bg-primary"
                      )}
                      aria-hidden
                    />
                    <span className="flex-1 space-y-1">
                      <span className="block text-sm font-medium">{notification.title}</span>
                      <span className="block text-xs text-muted-foreground line-clamp-3">
                        {notificationText(notification.content)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        {notification.sentByName && ` · ${notification.sentByName}`}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => dismiss(notification)}
                    aria-label="Clear"
                    title="Clear"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {notification.taskId && (
                    <div className="px-3 pb-3 pl-7">
                      {replyingTo === notification.id ? (
                        <QuickReply
                          taskId={notification.taskId}
                          canAskReply={canAskReply}
                          autoFocus
                          onSent={() => {
                            setReplyingTo(null);
                            dismiss(notification);
                          }}
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setReplyingTo(notification.id)}
                        >
                          <MessageSquareReply className="mr-1 h-3.5 w-3.5" /> Reply
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button asChild variant="ghost" className="w-full text-xs" onClick={() => setOpen(false)}>
            <Link href="/dashboard/settings/notifications">See all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

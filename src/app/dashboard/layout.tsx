"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useCallback, Fragment } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DashboardHeader, getInitials } from "@/components/dashboard/dashboard-header";
import { LogOut, Menu, X, ChevronLeft, ChevronRight, Building2, Search, Languages, Keyboard } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NotificationBell, NotificationProvider, useNotifications } from "@/components/notifications/notification-system";
import { PushSync } from "@/components/notifications/push-sync";
import { GlobalSearch } from "@/components/search/global-search";
import { ShortcutsDialog } from "@/components/layouts/shortcuts-dialog";
import { Tour } from "@/components/onboarding/tour";
import { LanguageProvider, useLanguage } from "@/components/language-provider";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { activeHref, BOTTOM_BAR_HREFS, navGroups, navItems, NavItem } from "@/components/layouts/nav-config";

const COLLAPSED_KEY = "sidebar-collapsed";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  // Not signed in: the middleware sends people to the login page
  if (status === "unauthenticated") return null;

  return (
    <LanguageProvider>
      <NotificationProvider>
        <DashboardShell>{children}</DashboardShell>
      </NotificationProvider>
    </LanguageProvider>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const { refreshNotifications } = useNotifications();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  // Open by default so new staff see the page names; each person's choice is remembered
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Changing it remounts the page, which reloads its data without reloading the app
  const [refreshKey, setRefreshKey] = useState(0);

  const role = session?.user?.role || "";
  const groups = navGroups(role);
  const items = navItems(role);
  const current = activeHref(pathname, items);
  const isManager = role === "ADMIN" || role === "PARTNER";

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {
      // Storage blocked: keep it open
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(!collapsed));
      } catch {
        // Remembered until the page is reloaded
      }
      return !collapsed;
    });
  };

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
    router.refresh();
    refreshNotifications();
  }, [router, refreshNotifications]);

  useKeyboardShortcuts({
    onSearch: () => setSearchOpen(true),
    onHelp: () => setShortcutsOpen(true),
    onGo: (key) => {
      const item = items.find((i) => i.shortcut === key);
      if (item) router.push(item.href);
    },
    onNewTask: isManager ? () => router.push("/dashboard/tasks/create") : undefined,
  });

  const avatarSrc = session?.user?.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${session?.user?.name}`;

  const SidebarLink = ({ item }: { item: NavItem }) => {
    const active = current === item.href;
    const content = (
      <Link
        href={item.href}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          sidebarCollapsed && "justify-center px-2",
          active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
        aria-current={active ? "page" : undefined}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {!sidebarCollapsed && <span className="flex-1 font-medium">{t(item.title)}</span>}
      </Link>
    );
    if (!sidebarCollapsed) return content;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{t(item.title)}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-h-screen flex-col overflow-x-hidden">
        <div className="flex flex-1">
          {/* Sidebar (desktop) */}
          <aside
            className={cn(
              "fixed bottom-0 top-0 z-40 hidden flex-col border-r bg-card transition-all duration-300 lg:flex",
              sidebarCollapsed ? "w-20" : "w-64"
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-4 z-20 -mr-3 h-6 w-6 rounded-full border bg-background shadow-sm"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Show menu names" : "Hide menu names"}
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              <span className="sr-only">Toggle Sidebar</span>
            </Button>

            <div className="flex h-14 items-center border-b px-4">
              <Link
                href="/dashboard/my-work"
                className={cn("flex items-center gap-2 font-semibold", sidebarCollapsed && "w-full justify-center")}
              >
                <Building2 className="h-6 w-6" />
                {!sidebarCollapsed && <span>MV Company</span>}
              </Link>
            </div>

            <ScrollArea className="flex-1 py-2">
              <nav className="space-y-3 px-2">
                {groups.map((group) => (
                  <div key={group.title} className="space-y-1">
                    {sidebarCollapsed ? (
                      <div className="mx-3 border-t first:hidden" />
                    ) : (
                      <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {t(group.title)}
                      </p>
                    )}
                    {group.items.map((item) => (
                      <SidebarLink key={item.href} item={item} />
                    ))}
                  </div>
                ))}
              </nav>
            </ScrollArea>

            <div className="mt-auto border-t p-3">
              <div className={cn("flex items-center gap-3 rounded-md p-1", sidebarCollapsed && "flex-col")}>
                <Avatar className="h-9 w-9">
                  <AvatarImage src={avatarSrc} alt={session?.user?.name ?? ""} />
                  <AvatarFallback>{getInitials(session?.user?.name)}</AvatarFallback>
                </Avatar>
                {!sidebarCollapsed && (
                  <div className="flex flex-1 flex-col truncate">
                    <span className="truncate text-sm font-medium">{session?.user?.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{session?.user?.email}</span>
                  </div>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8", !sidebarCollapsed && "ml-auto")}
                      onClick={() => signOut({ redirect: true, callbackUrl: "/login" })}
                    >
                      <LogOut className="h-4 w-4" />
                      <span className="sr-only">{t("Log out")}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("Log out")}</TooltipContent>
                </Tooltip>
              </div>
              {!sidebarCollapsed && (
                <p className="mt-2 flex justify-between px-1 text-[11px] text-muted-foreground/70">
                  <span>MV Company</span>
                  <span>© {new Date().getFullYear()}</span>
                </p>
              )}
            </div>
          </aside>

          <div className={cn("flex min-w-0 flex-1 flex-col", sidebarCollapsed ? "lg:ml-20" : "lg:ml-64")}>
            {/* Phone top bar */}
            <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background px-3 lg:hidden">
              <Link href="/dashboard/my-work" className="flex items-center gap-1.5 font-semibold">
                <Building2 className="h-6 w-6" />
                <span>MV Company</span>
              </Link>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)}>
                  <Search className="h-5 w-5" />
                  <span className="sr-only">{t("Search")}</span>
                </Button>
                <NotificationBell />
                <Avatar className="ml-1 h-8 w-8" onClick={() => setIsMobileNavOpen(true)}>
                  <AvatarImage src={avatarSrc} alt={session?.user?.name ?? ""} />
                  <AvatarFallback>{getInitials(session?.user?.name)}</AvatarFallback>
                </Avatar>
              </div>
            </header>

            <DashboardHeader onSearch={() => setSearchOpen(true)} onRefresh={refresh} onShortcuts={() => setShortcutsOpen(true)} />

            {/* Room at the bottom on phones for the tab bar */}
            <main className="flex-1 overflow-x-hidden p-3 pb-24 sm:p-4 sm:pb-24 md:p-6 md:pb-24 lg:pb-6">
              <PushSync />
              <Fragment key={refreshKey}>{children}</Fragment>
            </main>
          </div>

          {/* Phone bottom tab bar */}
          <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            {BOTTOM_BAR_HREFS.map((href) => items.find((i) => i.href === href))
              .filter((item): item is NavItem => !!item)
              .map((item) => {
                const active = current === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative flex flex-col items-center gap-0.5 py-2 text-[11px]",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="truncate">{t(item.title)}</span>
                  </Link>
                );
              })}
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
            >
              <Menu className="h-5 w-5" />
              <span>{t("Menu")}</span>
            </button>
          </nav>

          {/* Phone menu */}
          <div
            className={cn(
              "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-all duration-200 lg:hidden",
              isMobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
            )}
            onClick={() => setIsMobileNavOpen(false)}
          >
            <div
              className={cn(
                "fixed left-0 top-0 h-full w-[85%] max-w-xs bg-card shadow-xl transition-transform duration-300",
                isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={avatarSrc} alt={session?.user?.name ?? ""} />
                    <AvatarFallback>{getInitials(session?.user?.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="line-clamp-1 text-sm font-medium">{session?.user?.name}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{session?.user?.email}</span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <ScrollArea className="h-[calc(100%-64px)] px-3 py-2">
                <nav className="space-y-3">
                  {groups.map((group) => (
                    <div key={group.title} className="space-y-1">
                      <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {t(group.title)}
                      </p>
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsMobileNavOpen(false)}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2.5 text-base",
                            current === item.href ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <item.icon className="h-5 w-5" />
                          <span className="flex-1">{t(item.title)}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </nav>

                <div className="mt-4 space-y-1 border-t pt-3">
                  <div className="flex items-center gap-2 px-1">
                    <ThemeToggle />
                    <Button variant="ghost" className="flex-1 justify-start" onClick={() => setLanguage(language === "en" ? "hi" : "en")}>
                      <Languages className="mr-2 h-4 w-4" />
                      {language === "en" ? "हिंदी" : "English"}
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      setIsMobileNavOpen(false);
                      setShortcutsOpen(true);
                    }}
                  >
                    <Keyboard className="mr-2 h-4 w-4" />
                    {t("Keyboard shortcuts")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setIsMobileNavOpen(false);
                      signOut({ redirect: true, callbackUrl: "/login" });
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("Log out")}
                  </Button>
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} role={role} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} role={role} />
        <Tour role={role} />
      </div>
    </TooltipProvider>
  );
}

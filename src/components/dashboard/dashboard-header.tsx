"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { CloudSunIcon, Keyboard, Languages, Maximize, Minimize, MoonIcon, RefreshCw, SunIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/notifications/notification-system";
import { SearchButton } from "@/components/search/global-search";
import { useLanguage } from "@/components/language-provider";
import { START_TOUR_EVENT } from "@/components/onboarding/tour";

// Hour of the day in India (UTC+5:30)
function istHour() {
  const now = new Date();
  return Math.floor(((now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440) / 60);
}

export function getInitials(name?: string | null) {
  return (
    name
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .substring(0, 2) || "U"
  );
}

interface DashboardHeaderProps {
  onSearch: () => void;
  onRefresh: () => void;
  onShortcuts: () => void;
}

// The desktop header: greeting, search, notifications, refresh, language,
// full screen, theme and the profile menu. Phones have their own top bar.
export function DashboardHeader({ onSearch, onRefresh, onShortcuts }: DashboardHeaderProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const isLoading = status === "loading";
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const handleFullScreenChange = () => setIsFullScreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullScreenChange);
    handleFullScreenChange();
    return () => document.removeEventListener("fullscreenchange", handleFullScreenChange);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen?.();
    }
  };

  const displayName = session?.user?.name?.split(" ")[0] || session?.user?.email?.split("@")[0] || "User";
  const hour = istHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const GreetingIcon = hour < 12 ? SunIcon : hour < 17 ? CloudSunIcon : MoonIcon;
  const iconColour = hour < 12 ? "text-amber-400" : hour < 17 ? "text-blue-400" : "text-indigo-400";

  return (
    <div className="hidden h-14 items-center gap-4 border-b px-4 lg:flex">
      <div className="flex shrink-0 items-center px-2 text-muted-foreground">
        {isLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <>
            <GreetingIcon className={`mr-2 h-4 w-4 ${iconColour}`} />
            <span className="text-sm">
              {t(greeting)}, {displayName}!
            </span>
          </>
        )}
      </div>

      <SearchButton onClick={onSearch} className="mx-auto w-full max-w-md" />

      <div className="flex shrink-0 items-center justify-end gap-3">
        <div className="flex items-center gap-1 rounded-full border bg-background/80 px-2 py-1 shadow-sm backdrop-blur-sm">
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onRefresh}
            title={`${t("Refresh")} (keeps your place)`}
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">{t("Refresh")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => setLanguage(language === "en" ? "hi" : "en")}
            title={language === "en" ? "हिंदी में देखें" : "View in English"}
          >
            <Languages className="h-4 w-4" />
            <span className="sr-only">{t("Language")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={toggleFullScreen}
            title={isFullScreen ? "Exit Full Screen" : "Enter Full Screen"}
          >
            {isFullScreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullScreen ? "Exit Full Screen" : "Enter Full Screen"}</span>
          </Button>
          <div className="overflow-hidden rounded-full">
            <ThemeToggle />
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
              {isLoading ? (
                <Skeleton className="h-9 w-9 rounded-full" />
              ) : (
                <Avatar className="h-9 w-9">
                  <AvatarImage
                    src={session?.user?.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${session?.user?.name}`}
                    alt={session?.user?.name || "User"}
                  />
                  <AvatarFallback>{getInitials(session?.user?.name)}</AvatarFallback>
                </Avatar>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{session?.user?.name}</p>
                <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings/profile")}>Profile</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>{t("Settings")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/help")}>{t("Help")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}>{t("Take the tour")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onShortcuts}>
              <Keyboard className="mr-2 h-4 w-4" />
              {t("Keyboard shortcuts")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ redirect: true, callbackUrl: "/login" })}>{t("Log out")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

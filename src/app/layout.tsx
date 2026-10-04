"use client";

import "./globals.css";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { NotificationProvider } from "@/components/notifications/notification-system";
import { Toaster } from "sonner";
import { GlobalLoading } from "@/components/ui/global-loading";
import { AuthProvider } from "@/context/auth-provider";
import { usePathname } from "next/navigation";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        {/* Installable app (iPhone "Add to Home Screen", Android, desktop) */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#14213D" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="MVC Tasks" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>
            <NotificationProvider>
                {pathname !== '/' && <GlobalLoading />}
                {children}
                <Toaster position="top-right" richColors closeButton />
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

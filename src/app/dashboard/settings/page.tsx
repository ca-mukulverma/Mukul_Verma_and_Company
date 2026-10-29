"use client";

import Link from "next/link";
import { BellRing, BookOpen, Languages, PlayCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/components/language-provider";
import { START_TOUR_EVENT } from "@/components/onboarding/tour";

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4" /> {t("Language")}
          </CardTitle>
          <CardDescription>
            Shows the menu, header, Today and Help in Hindi on this device. Forms and sheets stay in English.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant={language === "en" ? "default" : "outline"} onClick={() => setLanguage("en")}>
            English
          </Button>
          <Button variant={language === "hi" ? "default" : "outline"} onClick={() => setLanguage("hi")}>
            हिंदी
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" /> Phone notifications
          </CardTitle>
          <CardDescription>
            Turn on alerts for tasks, billing and compliance on this phone or computer, and send yourself a test.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard/settings/notifications">Notification settings</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" /> {t("Help")}
          </CardTitle>
          <CardDescription>Short steps for every part of the app, and the 1-minute tour.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/help">{t("How to use the app")}</Link>
          </Button>
          <Button variant="outline" onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}>
            <PlayCircle className="mr-2 h-4 w-4" />
            {t("Take the tour")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-blue-100 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" /> Keep your account safe
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc space-y-1 pl-4">
            <li>Use a strong password that you don&apos;t use anywhere else</li>
            <li>Don&apos;t share your login; ask Admin for your own</li>
            <li>Log out on shared computers</li>
            <li>Keep your phone number and photo up to date in Profile</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

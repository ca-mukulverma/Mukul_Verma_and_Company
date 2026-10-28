"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";

// The "?" next to a page title: opens that page's part of the Help guide
export function HelpLink({ section, className }: { section: string; className?: string }) {
  const { t } = useLanguage();
  return (
    <Button asChild variant="ghost" size="icon" className={`h-8 w-8 rounded-full text-muted-foreground ${className ?? ""}`}>
      <Link href={`/dashboard/help#${section}`} title={`${t("Help")}: how this page works`}>
        <HelpCircle className="h-5 w-5" />
        <span className="sr-only">{t("Help")}</span>
      </Link>
    </Button>
  );
}

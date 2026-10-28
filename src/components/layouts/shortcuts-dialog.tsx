"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/components/language-provider";
import { navItems } from "@/components/layouts/nav-config";

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-1">
      {keys.map((k) => (
        <kbd key={k} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onOpenChange, role }: { open: boolean; onOpenChange: (open: boolean) => void; role: string }) {
  const { t } = useLanguage();
  const isManager = role === "ADMIN" || role === "PARTNER";
  const rows: { label: string; keys: string[] }[] = [
    { label: t("Search"), keys: ["Ctrl", "K"] },
    { label: `${t("Search")} (2)`, keys: ["/"] },
    ...(isManager ? [{ label: t("New task"), keys: ["N"] }] : []),
    { label: t("Keyboard shortcuts"), keys: ["?"] },
    ...navItems(role)
      .filter((item) => item.shortcut)
      .map((item) => ({ label: t(item.title), keys: ["G", item.shortcut!.toUpperCase()] })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Keyboard shortcuts")}</DialogTitle>
          <DialogDescription>
            Press G, then the letter, to open a page. Shortcuts don&apos;t work while you are typing in a box.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-1.5">
              <span>{row.label}</span>
              <Keys keys={row.keys} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          More in{" "}
          <Link href="/dashboard/help" className="underline" onClick={() => onOpenChange(false)}>
            {t("Help")}
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}

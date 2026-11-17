"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GST_BANK_ACCOUNT_DAYS, PICKABLE_TASK_KINDS, TASK_KIND_LABELS, TaskKindValue } from "@/lib/task-kinds";

export type PickableTaskKind = (typeof PICKABLE_TASK_KINDS)[number];

// Task type on the task forms: a general task, or one the app follows up
// when it is completed (docs/TASKS.md)
export function TaskKindSelect({
  value,
  onChange,
  disabled,
}: {
  value: PickableTaskKind | null;
  onChange: (value: PickableTaskKind | null) => void;
  disabled?: boolean;
}) {
  const options: { value: PickableTaskKind | null; label: string }[] = [
    { value: null, label: "General" },
    ...PICKABLE_TASK_KINDS.map((kind) => ({ value: kind, label: TASK_KIND_LABELS[kind] })),
  ];
  return (
    <div className="space-y-1.5">
      <div role="radiogroup" data-showme="task-kind" className="inline-flex flex-wrap gap-1 rounded-md border p-1">
        {options.map((option) => (
          <button
            key={option.value ?? "general"}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
              value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {value === "GST_REGISTRATION" && (
        <p className="text-xs text-muted-foreground">
          When this task is completed, a compulsory task to add the client&apos;s bank account in GST is created for the
          same people (no bill, due in {GST_BANK_ACCOUNT_DAYS} days).
        </p>
      )}
    </div>
  );
}

export function TaskKindBadge({ kind, className }: { kind?: string | null; className?: string }) {
  if (!kind || !(kind in TASK_KIND_LABELS)) return null;
  const compulsory = kind === "GST_BANK_ACCOUNT";
  return (
    <Badge
      variant="outline"
      className={cn(
        compulsory
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
        className
      )}
    >
      {TASK_KIND_LABELS[kind as TaskKindValue]}
      {compulsory && " · compulsory"}
    </Badge>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { COMPANY_LABELS, CompanyValue } from "@/lib/billing-constants";

const COMPANIES: CompanyValue[] = ["MVC", "BEDGE"];

// Two-button choice between MVC and B Edge, used on task and work-entry forms
export function CompanySelect({
  value,
  onChange,
  disabled,
}: {
  value: CompanyValue;
  onChange: (value: CompanyValue) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border p-1 gap-1">
      {COMPANIES.map((company) => (
        <button
          key={company}
          type="button"
          role="radio"
          aria-checked={value === company}
          disabled={disabled}
          onClick={() => onChange(company)}
          className={cn(
            "px-4 py-1.5 text-sm font-medium rounded transition-colors disabled:opacity-50",
            value === company
              ? company === "BEDGE"
                ? "bg-violet-600 text-white"
                : "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {COMPANY_LABELS[company]}
        </button>
      ))}
    </div>
  );
}

export function CompanyBadge({ company, className }: { company?: CompanyValue | null; className?: string }) {
  if (!company) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        company === "BEDGE"
          ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
          : "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
        className
      )}
    >
      {COMPANY_LABELS[company]}
    </Badge>
  );
}

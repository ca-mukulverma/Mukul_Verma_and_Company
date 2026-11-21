import { DEBTOR_ENTITIES, istToday, type DebtorEntity } from "@/lib/tally-debtors-shared";
import { salesPeriod, type Period, type PeriodKind } from "@/lib/tally-sales";

// ?firm=MVC|BEDGE|ALL&period=day|week|month|quarter|fy|custom&date=YYYY-MM-DD&to=YYYY-MM-DD
export function parseSalesParams(q: URLSearchParams): { entities: DebtorEntity[]; period: Period } | { error: string } {
  const firm = q.get("firm") ?? "ALL";
  const entities = firm === "ALL" ? [...DEBTOR_ENTITIES] : DEBTOR_ENTITIES.filter((e) => e === firm);
  if (!entities.length) return { error: "Choose MVC, B Edge or both" };
  const kind = (q.get("period") ?? "month") as PeriodKind;
  if (!["day", "week", "month", "quarter", "fy", "custom"].includes(kind)) return { error: "Choose a period" };
  const today = istToday();
  const date = q.get("date") ?? today;
  const to = q.get("to") ?? undefined;
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  if (!ok(date) || (to && !ok(to)) || date > today) return { error: "Choose a date up to today" };
  return { entities, period: salesPeriod(kind, date, today, to) };
}

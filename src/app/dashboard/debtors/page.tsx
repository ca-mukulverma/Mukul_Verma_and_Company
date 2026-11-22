"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Landmark, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { TallyPcPanel, SyncSetup } from "@/components/debtors/connect-tally-pc";
import { TallyExtensionCard } from "@/components/billing/tally-extension-card";
import { RecoveryCompare, RecoveryPanel } from "@/components/debtors/recovery-panel";
import { UpdateBanner, useSyncStatus } from "@/components/debtors/sync-status";
import { cn } from "@/lib/utils";
import { amount, balance, DEBTOR_ENTITIES, ENTITY_LABELS, isDebtorEntity, istToday, tallyDate, type DebtorEntity } from "@/lib/tally-debtors-shared";
import type { SyncStatus } from "@/lib/tally-debtors";

// Debtors: MVC's and B Edge's Sundry Debtors from their own Tally companies,
// each under its own Tally groups, with the time of each firm's Tally data
// and Refresh now, and each firm's recovery for a month. Admin and the
// partners Admin allows. docs/TALLY_DEBTORS.md

interface DebtorRow {
  id: string;
  entity: DebtorEntity;
  name: string;
  group: string;
  closing: number;
  lastReceiptDate: string | null;
  lastReceiptAmt: number | null;
  party: { kind: "client" | "connector"; id: string; name: string } | null;
}

interface FirmData {
  status: SyncStatus;
  setup: SyncSetup | null;
  rootGroup: string | null;
  groups: { name: string; parent: string }[];
}

interface DebtorsResponse {
  isAdmin: boolean;
  firms: Record<DebtorEntity, FirmData>;
  ledgers: DebtorRow[];
}

interface GroupNode {
  name: string;
  groups: GroupNode[];
  ledgers: DebtorRow[];
  total: number;
  count: number;
}

type FirmChoice = DebtorEntity | "BOTH";
const key = (s: string) => s.trim().toLowerCase();

// The groups under Sundry Debtors as in Tally, each with its ledgers and the
// total of everything under it
function buildTree(root: string, groups: { name: string; parent: string }[], ledgers: DebtorRow[]): GroupNode {
  const nodes = new Map<string, GroupNode>();
  const node = (name: string) => {
    let n = nodes.get(key(name));
    if (!n) {
      n = { name, groups: [], ledgers: [], total: 0, count: 0 };
      nodes.set(key(name), n);
    }
    return n;
  };
  const top = node(root);
  for (const g of groups) node(g.parent).groups.push(node(g.name));
  for (const l of ledgers) (nodes.get(key(l.group)) ?? top).ledgers.push(l);
  const sum = (n: GroupNode): [number, number] => {
    let total = n.ledgers.reduce((s, l) => s + l.closing, 0);
    let count = n.ledgers.length;
    for (const g of n.groups) {
      const [t, c] = sum(g);
      total += t;
      count += c;
    }
    n.total = Math.round(total * 100) / 100;
    n.count = count;
    return [total, count];
  };
  sum(top);
  return top;
}

// Leaves only the ledgers that pass, and the groups that still hold some
function filterTree(n: GroupNode, keep: (l: DebtorRow) => boolean): GroupNode {
  const groups = n.groups.map((g) => filterTree(g, keep)).filter((g) => g.count > 0);
  const ledgers = n.ledgers.filter(keep);
  const total = ledgers.reduce((s, l) => s + l.closing, 0) + groups.reduce((s, g) => s + g.total, 0);
  return { ...n, groups, ledgers, total: Math.round(total * 100) / 100, count: ledgers.length + groups.reduce((s, g) => s + g.count, 0) };
}

export default function DebtorsPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <DebtorsPage />
    </Suspense>
  );
}

function DebtorsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const firmParam = search.get("firm");
  const firm: FirmChoice = isDebtorEntity(firmParam) ? firmParam : firmParam === "BOTH" ? "BOTH" : "MVC";
  const view = search.get("view") === "ledgers" ? "ledgers" : "recovery";
  const month = /^\d{4}-\d{2}$/.test(search.get("month") ?? "") ? search.get("month")! : istToday().slice(0, 7);
  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    next.set(name, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const [data, setData] = useState<DebtorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Each firm's update time and Refresh now
  const syncMvc = useSyncStatus("MVC", data?.firms.MVC.status ?? null, reload);
  const syncBedge = useSyncStatus("BEDGE", data?.firms.BEDGE.status ?? null, reload);
  const syncs = { MVC: syncMvc, BEDGE: syncBedge };

  useEffect(() => {
    let cancelled = false;
    axios
      .get<DebtorsResponse>("/api/debtors")
      .then(({ data }) => !cancelled && (setData(data), setError(null)))
      .catch((e) => !cancelled && setError(apiError(e, "Could not load the debtors")));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const shown: DebtorEntity[] = firm === "BOTH" ? [...DEBTOR_ENTITIES] : [firm];

  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Landmark className="h-6 w-6" /> Debtors
          </h1>
          <p className="text-sm text-muted-foreground">
            Sundry Debtors from MVC&apos;s and B Edge&apos;s Tally, under the groups as made in Tally, and each firm&apos;s recovery.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Segmented
            label="Firm"
            value={firm}
            options={[
              ["MVC", "MVC"],
              ["BEDGE", "B Edge"],
              ["BOTH", "Both"],
            ]}
            onChange={(v) => setParam("firm", v)}
          />
          <Segmented
            label="Show"
            value={view}
            options={[
              ["recovery", "Recovery"],
              ["ledgers", "Ledgers"],
            ]}
            onChange={(v) => setParam("view", v)}
          />
        </div>
      </div>

      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          <div className={cn("grid gap-3", shown.length > 1 && "lg:grid-cols-2")}>
            {shown.map((e) => (
              <UpdateBanner key={e} sync={syncs[e]} compact={shown.length > 1} />
            ))}
          </div>

          {view === "recovery" ? (
            firm === "BOTH" ? (
              <RecoveryCompare month={month} onMonth={(m) => setParam("month", m)} reloadKey={reloadKey} />
            ) : (
              <RecoveryPanel entity={firm} month={month} onMonth={(m) => setParam("month", m)} reloadKey={reloadKey} />
            )
          ) : (
            <LedgerTree data={data} shown={shown} />
          )}

          {data.isAdmin && <TallyPcPanel setups={{ MVC: data.firms.MVC.setup, BEDGE: data.firms.BEDGE.setup }} onChanged={reload} />}
          <TallyExtensionCard />
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border p-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium", value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// The ledgers of the firm(s) shown, each firm under its own Tally groups
function LedgerTree({ data, shown }: { data: DebtorsResponse; shown: DebtorEntity[] }) {
  const [search, setSearch] = useState("");
  const [onlyBalance, setOnlyBalance] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const searching = search.trim().length > 0;

  const trees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shown.flatMap((entity) => {
      const f = data.firms[entity];
      if (!f.rootGroup) return [];
      const full = buildTree(f.rootGroup, f.groups, data.ledgers.filter((l) => l.entity === entity));
      const tree =
        !q && !onlyBalance
          ? full
          : filterTree(full, (l) => (!onlyBalance || l.closing !== 0) && (!q || l.name.toLowerCase().includes(q) || !!l.party?.name.toLowerCase().includes(q)));
      return [{ entity, company: f.setup?.company ?? null, tree }];
    });
  }, [data, shown, search, onlyBalance]);

  const groupKeys = useMemo(() => new Set(shown.flatMap((e) => data.firms[e].groups.map((g) => `${e}:${key(g.name)}`))), [data, shown]);
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  if (!trees.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">No debtors have come from Tally yet.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="w-72 pl-8" placeholder="Search a ledger or client" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyBalance} onCheckedChange={(v) => setOnlyBalance(v === true)} />
            Only ledgers with a balance
          </label>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(new Set(groupKeys))}>
              Expand all
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(new Set())}>
              Collapse all
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-y font-semibold">
                <th className="px-2 py-1.5 text-left">Particulars</th>
                <th className="px-2 py-1.5 text-left">Client in the app</th>
                <th className="px-2 py-1.5 text-right">Last receipt</th>
                <th className="px-2 py-1.5 text-right">Closing Balance</th>
              </tr>
            </thead>
            {trees.map(({ entity, company, tree }) => (
              <tbody key={entity}>
                {trees.length > 1 && (
                  <tr className="border-b bg-primary/10 font-bold">
                    <td className="px-2 py-2" colSpan={3}>
                      {ENTITY_LABELS[entity]}
                      {company ? ` (${company})` : ""}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{balance(tree.total)}</td>
                  </tr>
                )}
                <GroupRows entity={entity} node={tree} depth={0} isRoot open={open} forceOpen={searching} onToggle={toggle} />
                <tr className="border-y font-bold">
                  <td className="px-2 py-1.5" colSpan={3}>
                    {trees.length > 1 ? `${ENTITY_LABELS[entity]} total` : "Grand Total"} ({tree.count} ledger{tree.count === 1 ? "" : "s"})
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{balance(tree.total)}</td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupRows({
  entity,
  node,
  depth,
  isRoot = false,
  open,
  forceOpen,
  onToggle,
}: {
  entity: DebtorEntity;
  node: GroupNode;
  depth: number;
  isRoot?: boolean;
  open: Set<string>;
  forceOpen: boolean;
  onToggle: (k: string) => void;
}) {
  // Sundry Debtors itself is always open, like Tally's Group Summary
  const k = `${entity}:${key(node.name)}`;
  const expanded = isRoot || forceOpen || open.has(k);
  const pad = { paddingLeft: `${0.5 + depth * 1.25}rem` };
  return (
    <>
      {!isRoot && (
        <tr className="cursor-pointer border-b bg-muted/30 font-semibold hover:bg-muted/60" onClick={() => onToggle(k)}>
          <td className="px-2 py-1.5" style={pad} colSpan={3}>
            <span className="flex items-center gap-1.5">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {expanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
              {node.name}
              <span className="font-normal text-muted-foreground">({node.count})</span>
            </span>
          </td>
          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{balance(node.total)}</td>
        </tr>
      )}
      {expanded && (
        <>
          {node.groups.map((g) => (
            <GroupRows key={g.name} entity={entity} node={g} depth={isRoot ? 0 : depth + 1} open={open} forceOpen={forceOpen} onToggle={onToggle} />
          ))}
          {[...node.ledgers]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((l) => (
              <tr key={l.id} className="border-b hover:bg-muted/40">
                <td className="px-2 py-1.5" style={{ paddingLeft: `${(isRoot ? 0.5 : 2.25) + depth * 1.25}rem` }}>
                  <Link href={`/dashboard/debtors/${l.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td className="px-2 py-1.5">
                  {l.party ? (
                    l.party.kind === "client" ? (
                      <Link href={`/dashboard/clients/${l.party.id}`} className="underline-offset-2 hover:underline">
                        {l.party.name}
                      </Link>
                    ) : (
                      <span>
                        {l.party.name} <Badge variant="secondary">Connector</Badge>
                      </span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-muted-foreground">
                  {l.lastReceiptDate ? `${tallyDate(l.lastReceiptDate)} · ${amount(l.lastReceiptAmt ?? 0)}` : "—"}
                </td>
                <td className={cn("whitespace-nowrap px-2 py-1.5 text-right tabular-nums", l.closing < 0 && "text-emerald-700 dark:text-emerald-400")}>
                  {balance(l.closing)}
                </td>
              </tr>
            ))}
        </>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Landmark, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { ConnectTallyPc, SyncSetup } from "@/components/debtors/connect-tally-pc";
import { UpdateBanner, useSyncStatus } from "@/components/debtors/sync-status";
import { cn } from "@/lib/utils";
import { balance, tallyDate, amount } from "@/lib/tally-debtors-shared";
import type { SyncStatus } from "@/lib/tally-debtors";

// Debtors: the Sundry Debtors ledgers from Tally, under the groups as made in
// Tally, with when the data was read and Refresh now. Admin and the partners
// Admin allows. docs/TALLY_DEBTORS.md

interface DebtorRow {
  id: string;
  name: string;
  group: string;
  closing: number;
  lastReceiptDate: string | null;
  lastReceiptAmt: number | null;
  party: { kind: "client" | "connector"; id: string; name: string } | null;
}

interface DebtorsResponse {
  isAdmin: boolean;
  status: SyncStatus;
  setup: SyncSetup | null;
  rootGroup: string | null;
  groups: { name: string; parent: string }[];
  ledgers: DebtorRow[];
}

interface GroupNode {
  name: string;
  groups: GroupNode[];
  ledgers: DebtorRow[];
  total: number;
  count: number;
}

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

export default function DebtorsPage() {
  const [data, setData] = useState<DebtorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyBalance, setOnlyBalance] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const sync = useSyncStatus(data?.status ?? null, reload);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<DebtorsResponse>("/api/debtors")
      .then(({ data }) => {
        if (cancelled) return;
        setData(data);
        setError(null);
      })
      .catch((e) => !cancelled && setError(apiError(e, "Could not load the debtors")));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const tree = useMemo(() => {
    if (!data?.rootGroup) return null;
    const full = buildTree(data.rootGroup, data.groups, data.ledgers);
    const q = search.trim().toLowerCase();
    if (!q && !onlyBalance) return full;
    return filterTree(full, (l) => (!onlyBalance || l.closing !== 0) && (!q || l.name.toLowerCase().includes(q) || !!l.party?.name.toLowerCase().includes(q)));
  }, [data, search, onlyBalance]);

  const searching = search.trim().length > 0;
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key(name))) next.delete(key(name));
      else next.add(key(name));
      return next;
    });
  const allGroupNames = useMemo(() => new Set((data?.groups ?? []).map((g) => key(g.name))), [data]);

  if (error) {
    return <p className="text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Landmark className="h-6 w-6" /> Debtors
        </h1>
        <p className="text-sm text-muted-foreground">
          Sundry Debtors from Tally, under the groups as made in Tally. Click a ledger to see it, download it as PDF or Excel, or send it on
          WhatsApp.
        </p>
      </div>

      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          <UpdateBanner sync={sync} />

          {tree ? (
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
                    <Button variant="outline" size="sm" onClick={() => setOpen(new Set(allGroupNames))}>
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
                    <tbody>
                      <GroupRows node={tree} depth={0} isRoot open={open} forceOpen={searching} onToggle={toggle} />
                    </tbody>
                    <tfoot>
                      <tr className="border-y font-bold">
                        <td className="px-2 py-1.5" colSpan={3}>
                          Grand Total ({tree.count} ledger{tree.count === 1 ? "" : "s"})
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{balance(tree.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {tree.count === 0 && <p className="py-6 text-center text-muted-foreground">No ledgers match</p>}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">No debtors have come from Tally yet.</CardContent>
            </Card>
          )}

          {data.isAdmin && <ConnectTallyPc setup={data.setup} onChanged={reload} />}
        </>
      )}
    </div>
  );
}

function GroupRows({
  node,
  depth,
  isRoot = false,
  open,
  forceOpen,
  onToggle,
}: {
  node: GroupNode;
  depth: number;
  isRoot?: boolean;
  open: Set<string>;
  forceOpen: boolean;
  onToggle: (name: string) => void;
}) {
  // Sundry Debtors itself is always open, like Tally's Group Summary
  const expanded = isRoot || forceOpen || open.has(key(node.name));
  const pad = { paddingLeft: `${0.5 + depth * 1.25}rem` };
  return (
    <>
      {!isRoot && (
        <tr className="cursor-pointer border-b bg-muted/30 font-semibold hover:bg-muted/60" onClick={() => onToggle(node.name)}>
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
            <GroupRows key={g.name} node={g} depth={isRoot ? 0 : depth + 1} open={open} forceOpen={forceOpen} onToggle={onToggle} />
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

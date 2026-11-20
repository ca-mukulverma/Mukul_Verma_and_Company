"use client";

import { useState } from "react";
import type { Recovery } from "@/lib/tally-recovery";

// Billed and recovered per month for the last 12 months (one firm), as
// paired columns on one rupee axis. Recovery % is a different measure, so it
// is written under each month instead of a second axis. Hover a month for its
// figures; "Show as table" gives the same numbers as a table.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const rupees = (n: number) => `₹${INR.format(Math.round(n))}`;

// Axis labels in lakh / thousand: 0, 5L, 10L
function compact(n: number) {
  if (n >= 100_000) return `${Math.round((n / 100_000) * 10) / 10}L`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

const W = 760;
const H = 230;
const PAD = { l: 48, r: 8, t: 10, b: 46 };
const COL = 16; // column width (<= 24)
const GAP = 2; // surface gap between the pair

export function RecoveryTrend({ trend }: { trend: Recovery["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...trend.flatMap((t) => [t.billed, t.recovered]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotH = H - PAD.t - PAD.b;
  const band = (W - PAD.l - PAD.r) / Math.max(1, trend.length);
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  // Column with a 4px rounded top, square at the baseline
  const column = (x: number, v: number) => {
    const h = Math.max(0, (v / top) * plotH);
    if (h < 0.5) return "";
    const r = Math.min(4, h, COL / 2);
    const yb = PAD.t + plotH;
    const yt = yb - h;
    return `M${x},${yb} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + COL - r} Q${x + COL},${yt} ${x + COL},${yt + r} V${yb} Z`;
  };

  return (
    <div className="viz-root space-y-2">
      <style>{`
        .viz-root { --series-1: #2a78d6; --series-2: #eb6834; --grid: #e4e3df; }
        .dark .viz-root { --series-1: #3987e5; --series-2: #d95926; --grid: #34332f; }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-4 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--series-1)" }} /> Billed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--series-2)" }} /> Recovered (received + TDS)
          </span>
        </div>
        <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setTable(!table)}>
          {table ? "Show as chart" : "Show as table"}
        </button>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-y text-left">
                <th className="px-2 py-1">Month</th>
                <th className="px-2 py-1 text-right">Billed</th>
                <th className="px-2 py-1 text-right">Recovered</th>
                <th className="px-2 py-1 text-right">Recovery %</th>
                <th className="px-2 py-1 text-right">Dues at month end</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.month} className="border-b">
                  <td className="px-2 py-1">{monthShort(t.month)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(t.billed)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(t.recovered)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{t.recoveryPct == null ? "—" : `${t.recoveryPct}%`}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(t.closingDue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Billed and recovered in the last 12 months">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {compact(t)}
                </text>
              </g>
            ))}
            {trend.map((t, i) => {
              const cx = PAD.l + band * i + band / 2;
              const x1 = cx - COL - GAP / 2;
              const x2 = cx + GAP / 2;
              return (
                <g key={t.month} opacity={hover === null || hover === i ? 1 : 0.45}>
                  <path d={column(x1, t.billed)} fill="var(--series-1)" />
                  <path d={column(x2, t.recovered)} fill="var(--series-2)" />
                  <text x={cx} y={H - PAD.b + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
                    {monthShort(t.month)}
                  </text>
                  <text x={cx} y={H - PAD.b + 32} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={600}>
                    {t.recoveryPct == null ? "—" : `${t.recoveryPct}%`}
                  </text>
                  {/* Hover target: the whole month band */}
                  <rect
                    x={PAD.l + band * i}
                    y={PAD.t}
                    width={band}
                    height={H - PAD.t}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setHover(hover === i ? null : i)}
                  />
                </g>
              );
            })}
            <text x={PAD.l - 6} y={H - PAD.b + 32} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
              Rec. %
            </text>
          </svg>
          {hover !== null && trend[hover] && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
              style={{ left: `${Math.min(78, Math.max(2, ((PAD.l + band * hover + band / 2) / W) * 100 - 10))}%` }}
            >
              <p className="font-semibold">{monthShort(trend[hover].month)}</p>
              <p>Billed {rupees(trend[hover].billed)}</p>
              <p>Recovered {rupees(trend[hover].recovered)}</p>
              <p>Recovery {trend[hover].recoveryPct == null ? "—" : `${trend[hover].recoveryPct}%`}</p>
              <p>Dues at month end {rupees(trend[hover].closingDue)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

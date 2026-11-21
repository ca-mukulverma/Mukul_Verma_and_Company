"use client";

import { useState } from "react";
import type { SalesReport } from "@/lib/tally-sales";

// Sales month by month: this financial year beside the year before, as paired
// columns on one rupee axis (hover a month for its figures; "Show as table"
// gives the same numbers). Months not yet begun have no column.

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const rupees = (n: number) => `${n < 0 ? "−" : ""}₹${INR.format(Math.abs(Math.round(n)))}`;
const compact = (n: number) => (n >= 10_000_000 ? `${Math.round(n / 1_000_000) / 10}Cr` : n >= 100_000 ? `${Math.round(n / 10_000) / 10}L` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n));
function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

const W = 760;
const H = 230;
const PAD = { l: 52, r: 8, t: 10, b: 30 };
const COL = 16;
const GAP = 2;

export function SalesTrend({ trend, years }: { trend: SalesReport["trend"]; years: SalesReport["trendYears"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...trend.flatMap((t) => [t.now ?? 0, t.before]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotH = H - PAD.t - PAD.b;
  const band = (W - PAD.l - PAD.r) / trend.length;
  const y = (v: number) => PAD.t + plotH - (Math.max(0, v) / top) * plotH;
  const column = (x: number, v: number) => {
    const h = Math.max(0, (v / top) * plotH);
    if (h < 0.5) return "";
    const r = Math.min(4, h, COL / 2);
    const yb = PAD.t + plotH;
    const yt = yb - h;
    return `M${x},${yb} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + COL - r} Q${x + COL},${yt} ${x + COL},${yt + r} V${yb} Z`;
  };
  const growth = (t: (typeof trend)[number]) => (t.now == null || t.before <= 0 ? "—" : `${Math.round(((t.now - t.before) / t.before) * 1000) / 10}%`);

  return (
    <div className="viz-root space-y-2">
      <style>{`
        .viz-root { --series-1: #2a78d6; --series-2: #eb6834; --grid: #e4e3df; }
        .dark .viz-root { --series-1: #3987e5; --series-2: #d95926; --grid: #34332f; }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-4 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--series-1)" }} /> FY {years.now}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--series-2)" }} /> FY {years.before}
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
                <th className="px-2 py-1 text-right">FY {years.now}</th>
                <th className="px-2 py-1 text-right">FY {years.before}</th>
                <th className="px-2 py-1 text-right">Growth</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.month} className="border-b">
                  <td className="px-2 py-1">{t.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{t.now == null ? "—" : rupees(t.now)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{rupees(t.before)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{growth(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Sales by month, FY ${years.now} and FY ${years.before}`}>
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
              return (
                <g key={t.month} opacity={hover === null || hover === i ? 1 : 0.45}>
                  {t.now != null && <path d={column(cx - COL - GAP / 2, t.now)} fill="var(--series-1)" />}
                  <path d={column(cx + GAP / 2, t.before)} fill="var(--series-2)" />
                  <text x={cx} y={H - PAD.b + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
                    {t.label}
                  </text>
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
          </svg>
          {hover !== null && trend[hover] && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
              style={{ left: `${Math.min(76, Math.max(2, ((PAD.l + band * hover + band / 2) / W) * 100 - 10))}%` }}
            >
              <p className="font-semibold">{trend[hover].label}</p>
              <p>FY {years.now}: {trend[hover].now == null ? "—" : rupees(trend[hover].now!)}</p>
              <p>FY {years.before}: {rupees(trend[hover].before)}</p>
              <p>Growth {growth(trend[hover])}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

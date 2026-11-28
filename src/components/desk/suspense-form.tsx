"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SuspenseAnswer, SuspensePack } from "@/lib/desk-links";

// The client's phone page (/s/<token>): for each bank entry, tap what it is, then choose the party / ledger.
// Built for a phone: big buttons, native drop-downs, one Send button at the bottom.

type Draft = { nature: string; ledger: string; note: string; search: string };

const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export function SuspenseForm({ token, pack, answered }: { token: string; pack: SuspensePack; answered: Record<string, SuspenseAnswer> }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      pack.items.map((i) => {
        const a = answered[i.ref];
        return [i.ref, { nature: a?.nature ?? "", ledger: a?.ledger ?? "", note: a?.note ?? "", search: "" }];
      })
    )
  );
  const [sent, setSent] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(answered).map((r) => [r, true])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ledgersOf = useMemo(() => new Map(pack.natures.map((n) => [n.label, n.ledgers])), [pack.natures]);

  const set = (ref: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [ref]: { ...d[ref], ...patch } }));
  const ready = pack.items.filter((i) => drafts[i.ref].nature && (drafts[i.ref].ledger || drafts[i.ref].note.trim()));

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/public/suspense/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: ready.map((i) => ({ ref: i.ref, ...drafts[i.ref] })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not send. Please try again.");
      setSent((s) => ({ ...s, ...Object.fromEntries(ready.map((i) => [i.ref, true])) }));
      setMsg({ ok: true, text: `Thank you! ${j.saved} answer(s) sent to MVC. You can change an answer and send again.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not send. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-3 pb-28 pt-4">
      <h1 className="text-lg font-semibold leading-tight">{pack.company}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        MVC &amp; Company could not identify these bank entries. For each one: <b>1.</b> tap what it is, <b>2.</b> choose
        the party / ledger. Then press <b>Send</b>.
      </p>
      {!pack.items.length && <p className="mt-6 rounded-lg border p-4 text-center">Nothing to explain now. Thank you!</p>}
      <div className="mt-4 space-y-4">
        {pack.items.map((i) => {
          const d = drafts[i.ref];
          const all = ledgersOf.get(d.nature) ?? [];
          const q = d.search.trim().toLowerCase();
          const shown = q ? all.filter((l) => l.toLowerCase().includes(q)) : all;
          return (
            <section key={i.ref} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {day(i.date)} · {i.bank || "Bank"} · {i.ref}
                </span>
                <span className={`text-base font-semibold ${i.direction === "IN" ? "text-green-700" : "text-red-700"}`}>
                  {i.direction === "IN" ? "Received" : "Paid"} ₹{inr(i.amount)}
                </span>
              </div>
              <p className="mt-1 break-words text-sm">{i.narration}</p>
              {sent[i.ref] && (
                <p className="mt-1 flex items-center gap-1 text-xs text-green-700">
                  <Check className="h-3 w-3" /> answer sent
                </p>
              )}
              <p className="mt-3 text-sm font-medium">1. What is it?</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {pack.natures.map((n) => (
                  <button
                    key={n.label}
                    type="button"
                    onClick={() => set(i.ref, { nature: n.label, ledger: "", search: "" })}
                    className={`rounded-full border px-3 py-2 text-sm ${d.nature === n.label ? "border-blue-700 bg-blue-700 text-white" : "bg-background"}`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
              {d.nature && (
                <>
                  <p className="mt-3 text-sm font-medium">2. Which party / ledger?</p>
                  {all.length > 12 && (
                    <input
                      value={d.search}
                      onChange={(e) => set(i.ref, { search: e.target.value })}
                      placeholder="Type to find…"
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-base"
                    />
                  )}
                  <select
                    value={d.ledger}
                    onChange={(e) => set(i.ref, { ledger: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-3 text-base"
                  >
                    <option value="">{shown.length ? "Choose…" : "Not in the list – write below"}</option>
                    {shown.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={d.note}
                    onChange={(e) => set(i.ref, { note: e.target.value })}
                    placeholder="Anything to add (optional), e.g. name of the person, bill no."
                    rows={2}
                    className="mt-2 w-full rounded-lg border px-3 py-2 text-base"
                  />
                </>
              )}
            </section>
          );
        })}
      </div>
      {msg && (
        <p className={`mt-4 rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{msg.text}</p>
      )}
      {pack.items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {ready.length} of {pack.items.length} ready
            </span>
            <Button size="lg" onClick={send} disabled={busy || !ready.length}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

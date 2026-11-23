"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCheck, ClipboardPlus, FileText, Loader2, MessageCircle, RotateCcw, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/components/compliance/types";
import { cn } from "@/lib/utils";

// WhatsApp inbox (docs/WHATSAPP_INTAKE.md): every client message from the
// groups the firm's number is in. A request or question stays open until MVC
// replies in the group (seen automatically) or someone makes a task / marks
// it. After 3 office hours without either, the client's manager and Admin get
// an alert. Files are handed to the client's Desk where it has one.

interface Msg {
  id: string;
  sentAt: string;
  senderName: string | null;
  senderPhone: string;
  text: string | null;
  fileName: string | null;
  kind: string;
  status: string;
  taskId: string | null;
  answeredAt: string | null;
  alertedAt: string | null;
  deskStatus: string | null;
  clientName: string | null;
  group: { name: string };
}
interface Group {
  id: string;
  jid: string;
  name: string;
  clientId: string | null;
  deskClientId: string | null;
  active: boolean;
  _count: { messages: number };
}
interface Admin {
  groups: Group[];
  clients: { id: string; companyName: string | null; contactPerson: string }[];
  desks: { id: string; code: string; name: string }[];
  listenerLastSeen: string | null;
  staffWithoutPhone: string[];
  keySet: boolean;
}

const KIND: Record<string, string> = { REQUEST: "Request", QUERY: "Question", DOCUMENT: "File", INFO: "Information", CHAT: "Chat" };
const STATUS: Record<string, string> = { NEW: "Waiting for reply", TASK: "Task made", ANSWERED: "Answered", INFO: "Information", FILED: "Filed", CLOSED: "Closed" };
const when = (s: string) => new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function WhatsAppInbox() {
  const [show, setShow] = useState<"open" | "all">("open");
  const [data, setData] = useState<{ messages: Msg[]; counts: Record<string, number>; canMakeTask: boolean } | null>(null);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/whatsapp/inbox", { params: { show } })
      .then(({ data }) => !cancelled && setData(data))
      .catch((e) => toast.error(apiError(e, "Could not load the inbox")));
    axios
      .get<Admin>("/api/admin/whatsapp/groups")
      .then(({ data }) => !cancelled && setAdmin(data))
      .catch(() => undefined); // not Admin: no group settings
    return () => {
      cancelled = true;
    };
  }, [show, key]);

  const act = async (id: string, action: string) => {
    setBusy(id + action);
    try {
      await axios.patch("/api/whatsapp/inbox", { id, action });
      toast.success(action === "task" ? "Task made for the client's manager" : "Saved");
      reload();
    } catch (e) {
      toast.error(apiError(e, "Could not save"));
    } finally {
      setBusy(null);
    }
  };

  const link = async (g: Group, change: Partial<Group>) => {
    try {
      await axios.patch("/api/admin/whatsapp/groups", { id: g.id, ...change });
      toast.success("Saved");
      reload();
    } catch (e) {
      toast.error(apiError(e, "Could not save"));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageCircle className="h-6 w-6" /> WhatsApp inbox
        </h1>
        <p className="text-sm text-muted-foreground">
          Client messages from the WhatsApp groups. A request stays open until someone from MVC replies in the group, makes a task or marks it.
          After 3 office hours without a reply, the client&apos;s manager and Admin are alerted.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["open", "all"] as const).map((s) => (
          <Button key={s} size="sm" variant={show === s ? "default" : "outline"} onClick={() => setShow(s)}>
            {s === "open" ? `Waiting for reply${data?.counts.NEW ? ` (${data.counts.NEW})` : ""}` : "All (last 300)"}
          </Button>
        ))}
      </div>

      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-y text-left">
                  <th className="px-2 py-1">When</th>
                  <th className="px-2 py-1">Client / group</th>
                  <th className="px-2 py-1">From</th>
                  <th className="px-2 py-1">Message</th>
                  <th className="px-2 py-1">Kind</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.messages.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                      {show === "open" ? "Nothing waiting – every client message has a reply or a task." : "No messages yet."}
                    </td>
                  </tr>
                )}
                {data.messages.map((m) => (
                  <tr key={m.id} className={cn("border-b align-top", m.status === "NEW" && m.alertedAt && "bg-red-50 dark:bg-red-950/30")}>
                    <td className="whitespace-nowrap px-2 py-1.5">{when(m.sentAt)}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{m.clientName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{m.group.name}</div>
                    </td>
                    <td className="px-2 py-1.5">{m.senderName ?? m.senderPhone}</td>
                    <td className="max-w-[360px] px-2 py-1.5">
                      {m.fileName && (
                        <div className="flex items-center gap-1 text-xs">
                          <FileText className="h-3.5 w-3.5" /> {m.fileName}
                          {m.deskStatus && <span className="text-muted-foreground">· {m.deskStatus === "COLLECTED" ? "in the Desk" : "waiting for the Desk"}</span>}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    </td>
                    <td className="px-2 py-1.5">{KIND[m.kind] ?? m.kind}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {STATUS[m.status] ?? m.status}
                      {m.status === "NEW" && m.alertedAt && <div className="text-xs font-semibold text-red-700 dark:text-red-400">over 3 hours</div>}
                      {m.taskId && (
                        <a className="block text-xs text-primary underline" href={`/dashboard/tasks/${m.taskId}`}>
                          open task
                        </a>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {busy?.startsWith(m.id) ? (
                        <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                      ) : m.status === "NEW" ? (
                        <div className="flex justify-end gap-1">
                          {data.canMakeTask && (
                            <Button size="sm" variant="outline" onClick={() => act(m.id, "task")} title="Task for the client's manager">
                              <ClipboardPlus className="mr-1 h-4 w-4" /> Task
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => act(m.id, "answered")} title="Replied outside the group (call, email)">
                            <CheckCheck className="mr-1 h-4 w-4" /> Answered
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => act(m.id, "info")} title="Needs no reply">
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => act(m.id, "close")} title="Close">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        !["TASK"].includes(m.status) && (
                          <Button size="sm" variant="ghost" onClick={() => act(m.id, "reopen")} title="Back to waiting">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {admin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Groups (Admin)</CardTitle>
            <CardDescription>
              The listener on the office PC was last heard from{" "}
              <b>{admin.listenerLastSeen ? new Date(admin.listenerLastSeen).toLocaleString("en-IN") : "never"}</b>
              {!admin.keySet && " — WA_LISTENER_KEY is not set in Vercel yet"}. Link each group to its client, and to the client&apos;s Desk if its files
              should go there.
              {admin.staffWithoutPhone.length > 0 && (
                <span className="mt-1 block text-amber-700 dark:text-amber-400">
                  No phone saved for: {admin.staffWithoutPhone.join(", ")} — their replies in groups are not recognised (Users → edit → phone).
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y text-left">
                  <th className="px-2 py-1">Group</th>
                  <th className="px-2 py-1">Client</th>
                  <th className="px-2 py-1">Desk (files)</th>
                  <th className="px-2 py-1 text-right">Messages</th>
                  <th className="px-2 py-1">On</th>
                </tr>
              </thead>
              <tbody>
                {admin.groups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                      No group yet — they appear after the listener&apos;s first batch.
                    </td>
                  </tr>
                )}
                {admin.groups.map((g) => (
                  <tr key={g.id} className="border-b">
                    <td className="px-2 py-1">{g.name}</td>
                    <td className="px-2 py-1">
                      <select className="w-full rounded border bg-background p-1" value={g.clientId ?? ""} onChange={(e) => link(g, { clientId: e.target.value || null })}>
                        <option value="">— not linked —</option>
                        {admin.clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.companyName || c.contactPerson}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className="w-full rounded border bg-background p-1" value={g.deskClientId ?? ""} onChange={(e) => link(g, { deskClientId: e.target.value || null })}>
                        <option value="">— no Desk —</option>
                        {admin.desks.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{g._count.messages}</td>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={g.active} onChange={(e) => link(g, { active: e.target.checked })} aria-label="Group on" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

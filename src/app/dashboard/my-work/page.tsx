"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CompanyBadge } from "@/components/billing/company-select";
import { HelpLink } from "@/components/help/help-link";
import { useLanguage } from "@/components/language-provider";
import type { DueState, MyComplianceItem, MyTask, MyWork } from "@/lib/my-work";

const DUE_STYLES: Record<DueState, string> = {
  overdue: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  today: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  soon: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  later: "",
  none: "",
};

function DueBadge({ due, date }: { due: DueState; date: string | null }) {
  if (!date) return <span className="text-xs text-muted-foreground">No due date</span>;
  const label = due === "overdue" ? "Overdue" : due === "today" ? "Due today" : `Due ${format(new Date(date), "d MMM")}`;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", DUE_STYLES[due])}>
      {due === "overdue" && <AlertTriangle className="mr-1 h-3 w-3" />}
      {label}
      {due === "overdue" && ` · ${format(new Date(date), "d MMM")}`}
    </Badge>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  review: "In review",
  data_received: "Data received",
};

const SHEET_TAB: Record<string, string> = {
  GSTR1: "gst",
  GSTR3B: "gst",
  TDS_PAYMENT: "tds",
  TDS_RETURN: "tds",
  GENERIC: "work",
};

function Tile({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className={cn("border-l-4", tone)}>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className="h-6 w-6 text-muted-foreground/60" />
      </CardContent>
    </Card>
  );
}

// Everything waiting for the signed-in person, in one list: their tasks, the
// compliance work of their teams that is due, and billing waiting for them.
export default function MyWorkPage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const [work, setWork] = useState<MyWork | null>(null);
  const [error, setError] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const isManager = session?.user?.role === "ADMIN" || session?.user?.role === "PARTNER";

  const load = useCallback(async () => {
    try {
      const response = await axios.get<MyWork>("/api/my-work");
      setWork(response.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setTaskStatus = async (task: MyTask, status: string, withUndo: boolean) => {
    setBusyTask(task.id);
    try {
      await axios.patch(`/api/tasks/${task.id}/status`, { status });
      if (withUndo) {
        toast.success(status === "completed" ? `“${task.title}” marked done` : `“${task.title}” started`, {
          duration: 7000,
          action: {
            label: t("Undo"),
            onClick: async () => {
              try {
                await axios.patch(`/api/tasks/${task.id}/status`, { status: task.status });
                toast.success("Undone");
              } catch {
                toast.error("Could not undo. Open the task to change its status.");
              }
              load();
            },
          },
        });
      }
      await load();
    } catch {
      toast.error("Could not update the task. Try again, or open it.");
    } finally {
      setBusyTask(null);
    }
  };

  const counts = work?.counts;
  const nothingWaiting =
    work && work.tasks.length === 0 && work.compliance.length === 0 && work.billing.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("Today")}</h1>
            <HelpLink section="my-work" />
          </div>
          <p className="text-muted-foreground">
            {format(new Date(), "EEEE, d MMMM")} · {t("Everything waiting for you, from Tasks, Compliance and Billing.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <Button asChild>
              <Link href="/dashboard/tasks/create">
                <Plus className="mr-1 h-4 w-4" />
                {t("New task")}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/dashboard/billing?tab=log">
              <Receipt className="mr-1 h-4 w-4" />
              {t("Log work for billing")}
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>Your work could not be loaded. Check your connection.</span>
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!work && !error ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        counts && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label={t("Overdue")} value={counts.tasksOverdue + counts.complianceOverdue} tone="border-l-red-500" icon={AlertTriangle} />
              <Tile label={t("Due today")} value={counts.tasksDueToday} tone="border-l-amber-500" icon={CalendarClock} />
              <Tile label={`${t("Compliance")}: ${t("Due soon")}`} value={counts.complianceDueSoon} tone="border-l-sky-500" icon={CalendarCheck} />
              <Tile label={t("Billing waiting for me")} value={counts.billing} tone="border-l-violet-500" icon={Receipt} />
            </div>

            {nothingWaiting && (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                  <p className="text-lg font-semibold">{t("Nothing waiting. Well done!")}</p>
                  <p className="text-sm text-muted-foreground">New tasks and due compliance work will show up here.</p>
                </CardContent>
              </Card>
            )}

            {work && work.tasks.length > 0 && (
              <TaskSection tasks={work.tasks} busyTask={busyTask} onStatus={setTaskStatus} />
            )}
            {work && !nothingWaiting && work.tasks.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("No tasks assigned to you.")}</p>
            )}

            {work && work.compliance.length > 0 && <ComplianceSection items={work.compliance} waitingFiles={counts.complianceWaitingFiles} />}
            {work && !nothingWaiting && work.compliance.length === 0 && counts.complianceWaitingFiles > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("No compliance work due in the next 7 days.")} {counts.complianceWaitingFiles} {t("Filed, waiting for files or steps").toLowerCase()}.
              </p>
            )}

            {work && work.billing.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Receipt className="h-5 w-5" />
                    {t("Billing waiting for me")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {work.billing.map((group) => (
                    <Link key={group.key} href={group.link} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/50">
                      <span className="text-sm">{group.label}</span>
                      <span className="flex items-center gap-2">
                        {group.overdue > 0 && (
                          <Badge variant="outline" className={DUE_STYLES.overdue}>
                            {group.overdue} over 3 days
                          </Badge>
                        )}
                        <Badge>{group.count}</Badge>
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )
      )}
    </div>
  );
}

function TaskSection({
  tasks,
  busyTask,
  onStatus,
}: {
  tasks: MyTask[];
  busyTask: string | null;
  onStatus: (task: MyTask, status: string, withUndo: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {t("My tasks")}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/tasks">All tasks</Link>
          </Button>
        </CardTitle>
        <CardDescription>Overdue and due first. Marking a task done sends its bill to billing.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {tasks.map((task) => (
          <div key={task.id} className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/tasks/${task.id}`} className="font-medium hover:underline">
                {task.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {task.client && <span>{task.client}</span>}
                <span>{STATUS_LABELS[task.status] ?? task.status}</span>
                {task.priority === "high" && (
                  <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-300">
                    High priority
                  </Badge>
                )}
                <CompanyBadge company={task.company as "MVC" | "BEDGE"} />
                {task.unreadComments > 0 && (
                  <span className="flex items-center gap-1 text-primary">
                    <MessageSquare className="h-3 w-3" />
                    {task.unreadComments} new comment{task.unreadComments === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DueBadge due={task.due} date={task.dueDate} />
              {task.status === "pending" && (
                <Button size="sm" variant="outline" disabled={busyTask === task.id} onClick={() => onStatus(task, "in_progress", true)}>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  {t("Start")}
                </Button>
              )}
              <Button size="sm" disabled={busyTask === task.id} onClick={() => onStatus(task, "completed", true)}>
                {busyTask === task.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                {t("Mark done")}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ComplianceSection({ items, waitingFiles }: { items: MyComplianceItem[]; waitingFiles: number }) {
  const { t } = useLanguage();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            {t("My compliance work")}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/compliance">Sheets</Link>
          </Button>
        </CardTitle>
        <CardDescription>
          Not filed yet and due within 7 days, for the works whose team you are on.
          {waitingFiles > 0 && ` ${waitingFiles} more filed, waiting for files or steps.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {items.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item.client}</p>
              <p className="text-xs text-muted-foreground">
                {item.work} · {item.period} · {STATUS_LABELS[item.status] ?? item.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DueBadge due={item.due} date={item.dueDate} />
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/dashboard/compliance?tab=${SHEET_TAB[item.kind] ?? "work"}&item=${item.id}${
                    item.kind === "GENERIC" ? `&work=${item.workTypeId}` : ""
                  }`}
                >
                  {t("Open")}
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

"use client";

import { HelpLink } from "@/components/help/help-link";
import { TaskExportButton, TaskImportDialog } from "@/components/tasks/task-transfer";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { format, formatDistanceToNow, differenceInCalendarDays } from "date-fns";

import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Link from "next/link";
import {
  Search,
  Plus,
  Edit,
  Loader2,
  ClipboardList,
  RefreshCw,
  Grid,
  List,
  MessageSquare,
  MessageSquareReply,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { TaskAssignees } from "@/components/tasks/task-assignees";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { getTaskListScroll, saveTaskListScroll, saveTaskListUrl } from "@/lib/task-list-state";
import { CompanyBadge } from "@/components/billing/company-select";
import { TaskDetailView } from "@/components/tasks/task-detail-view";
import { QuickReply, loadQuickComments } from "@/components/tasks/quick-reply";
import { cn } from "@/lib/utils";
import { BILL_STAGE_LABEL, MAX_QUICK_COMMENTS, TASK_VIEWS, TaskView, VIEW_LABEL, followsUpTasks } from "@/lib/task-views";

// The task list (docs/TASKS.md): Active work, Done – awaiting bill, Closed,
// and for Admin the deletion requests. A task opens in a side panel; the
// arrow keys move to the previous / next task. Admins and partners who follow
// up tasks see the last comments on each card and comment with one click.

interface TaskUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ListTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  company?: "MVC" | "BEDGE";
  completedAt: string | null;
  createdAt: string;
  assignedById: string;
  assignedBy: { id: string; name: string };
  client: { id: string; contactPerson: string; companyName: string | null } | null;
  assignees: { userId: string; user: TaskUser }[];
  billStage: string | null;
  pendingDeletion: { id: string; reason: string | null; createdAt: string; requestedBy: { id: string; name: string } } | null;
  lastActivity: { at: string; text: string };
  waitingOn: string[];
  awaitingReply: number;
  awaitingMyReply: boolean;
  recentComments?: { id: string; content: string; createdAt: string; attachments: unknown; user: { id: string; name: string } }[];
}

interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const QUICK_FILTERS = [
  { key: "waiting_on_me", label: "Waiting on me" },
  { key: "unanswered", label: "Unanswered comment" },
  { key: "overdue", label: "Overdue" },
  { key: "stale", label: "No update 3+ days" },
] as const;
type QuickFilterKey = (typeof QUICK_FILTERS)[number]["key"];

const ACTIVE_STATUSES = [
  { key: "all", label: "All active" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
] as const;

const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};
const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

const clientName = (c: ListTask["client"]) => (c ? c.companyName || c.contactPerson : null);
const ago = (date: string) => formatDistanceToNow(new Date(date), { addSuffix: true });
const isOverdue = (t: ListTask) =>
  !!t.dueDate && new Date(t.dueDate) < new Date() && ["pending", "in_progress", "review"].includes(t.status);

function StatusBadge({ task }: { task: ListTask }) {
  if (task.pendingDeletion) {
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Deletion requested</Badge>;
  }
  return <Badge className={cn("whitespace-nowrap", STATUS_COLOR[task.status])}>{task.status.replace("_", " ")}</Badge>;
}

// Shown on every card: when the task last moved, who has the ball, and for
// finished work where its bill is
function TaskFacts({ task, view }: { task: ListTask; view: TaskView }) {
  const days = task.completedAt ? differenceInCalendarDays(new Date(), new Date(task.completedAt)) : null;
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>
        {task.lastActivity.text} · {ago(task.lastActivity.at)}
      </p>
      {task.waitingOn.length > 0 && view === "active" && (
        <p>
          Waiting on: <span className="font-medium text-foreground">{task.waitingOn.join(", ")}</span>
          {task.awaitingReply > 0 && <span className="text-amber-700 dark:text-amber-400"> (reply asked)</span>}
        </p>
      )}
      {task.billStage && (
        <p>
          Bill: <span className="font-medium text-foreground">{BILL_STAGE_LABEL[task.billStage] ?? task.billStage}</span>
          {view === "awaiting_bill" && days !== null && ` · ${days === 0 ? "completed today" : `${days} day${days === 1 ? "" : "s"} waiting`}`}
        </p>
      )}
    </div>
  );
}

function RecentComments({ task }: { task: ListTask }) {
  if (!task.recentComments) return null;
  if (!task.recentComments.length) return <p className="text-xs text-muted-foreground">No comments yet</p>;
  return (
    <ul className="space-y-1">
      {task.recentComments.map((c) => (
        <li key={c.id} className="truncate text-xs" title={c.content}>
          <span className="font-medium">{c.user.name.split(" ")[0]}:</span>{" "}
          {c.content || <span className="text-muted-foreground">(attachment)</span>}{" "}
          <span className="text-muted-foreground">· {formatDistanceToNow(new Date(c.createdAt))}</span>
        </li>
      ))}
    </ul>
  );
}

function TaskCard({
  task,
  view,
  selected,
  followUp,
  isAdmin,
  canEdit,
  onOpen,
  onCommented,
  onDecide,
}: {
  task: ListTask;
  view: TaskView;
  selected: boolean;
  followUp: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onCommented: () => void;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  const [writing, setWriting] = useState(false);
  const client = clientName(task.client);
  return (
    <div
      onClick={onOpen}
      className={cn(
        "flex h-full cursor-pointer flex-col gap-2 rounded-lg border p-3 shadow-sm transition-colors hover:bg-muted/50 sm:p-4",
        selected && "ring-2 ring-primary",
        task.awaitingMyReply && "border-amber-300 dark:border-amber-800"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge task={task} />
        <div className="flex items-center gap-1.5">
          {task.awaitingMyReply && (
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
              Your reply
            </Badge>
          )}
          <CompanyBadge company={task.company} className="whitespace-nowrap" />
          <Badge variant="outline" className={cn("whitespace-nowrap", PRIORITY_COLOR[task.priority])}>
            {task.priority}
          </Badge>
        </div>
      </div>

      <div>
        <h3 className="line-clamp-2 text-base font-medium">{task.title}</h3>
        {client && <p className="truncate text-xs text-muted-foreground">{client}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={cn("text-muted-foreground", isOverdue(task) && "font-medium text-red-600 dark:text-red-400")}>
          Due: {task.dueDate ? format(new Date(task.dueDate), "dd MMM yyyy") : "—"}
        </span>
        {task.assignees.length > 0 ? (
          <TaskAssignees assignees={task.assignees} limit={3} size="sm" />
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </div>

      <TaskFacts task={task} view={view} />

      {task.pendingDeletion && (
        <div className="rounded-md bg-red-50 p-2 text-xs dark:bg-red-950/30" onClick={(e) => e.stopPropagation()}>
          <p>
            <span className="font-medium">{task.pendingDeletion.requestedBy.name}</span> asked {ago(task.pendingDeletion.createdAt)}
            {task.pendingDeletion.reason && <>: {task.pendingDeletion.reason}</>}
          </p>
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" className="h-7" onClick={() => onDecide("approve")}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => onDecide("reject")}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}

      {followUp && !task.pendingDeletion && (
        <div className="mt-auto space-y-2 border-t pt-2" onClick={(e) => e.stopPropagation()}>
          <RecentComments task={task} />
          <QuickReply taskId={task.id} canAskReply showText={writing} onSent={() => { setWriting(false); onCommented(); }} />
          {!writing && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setWriting(true)}>
              <MessageSquareReply className="mr-1 h-3.5 w-3.5" /> Write a comment
            </Button>
          )}
        </div>
      )}

      {canEdit && !task.pendingDeletion && view === "active" && !followUp && (
        <div className="mt-auto flex justify-end border-t pt-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
            <Link href={`/dashboard/tasks/${task.id}/edit`}>
              <Edit className="mr-1 h-3.5 w-3.5" /> Edit
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// Admin: the one-click comments shown on cards, in the bell and on Today
function QuickCommentsEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) loadQuickComments().then((c) => setText(c.join("\n")));
  }, [open]);
  const save = async () => {
    const comments = text.split("\n").map((l) => l.trim()).filter(Boolean);
    setSaving(true);
    try {
      await axios.put("/api/tasks/quick-comments", { comments });
      await loadQuickComments(true);
      toast.success("Quick comments saved");
      onClose();
    } catch (error) {
      toast.error(errorText(error, "Couldn't save the quick comments"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick comments</DialogTitle>
          <DialogDescription>
            One per line, up to {MAX_QUICK_COMMENTS}. They show as one-click buttons on task cards, in the bell and on Today.
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function readParams() {
  const url = new URL(window.location.href);
  const view = url.searchParams.get("view") as TaskView | null;
  const status = url.searchParams.get("status");
  const filter = url.searchParams.get("filter") as QuickFilterKey | null;
  const mode = url.searchParams.get("mode");
  let savedMode: string | null = null;
  try {
    savedMode = localStorage.getItem("taskViewMode");
  } catch {
    // ignore
  }
  return {
    view: view && TASK_VIEWS.includes(view) ? view : "active",
    status: status && ACTIVE_STATUSES.some((s) => s.key === status) ? status : "all",
    filter: filter && QUICK_FILTERS.some((f) => f.key === filter) ? filter : null,
    search: url.searchParams.get("search") ?? "",
    page: Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1),
    mine: url.searchParams.get("mytasks") === "true",
    mode: (mode === "table" || mode === "card" ? mode : savedMode === "table" ? "table" : "card") as "card" | "table",
    open: url.searchParams.get("open"),
  };
}

export default function TasksPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const canManageTasks = isAdmin || session?.user?.role === "PARTNER";

  const [ready, setReady] = useState(false);
  const [view, setView] = useState<TaskView>("active");
  const [status, setStatus] = useState("all");
  const [filter, setFilter] = useState<QuickFilterKey | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [mine, setMine] = useState(false);
  const [mode, setMode] = useState<"card" | "table">("card");
  const [openId, setOpenId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<ListTask[]>([]);
  const [followUp, setFollowUp] = useState(followsUpTasks(session?.user));
  const [viewCounts, setViewCounts] = useState<Partial<Record<TaskView, number>>>({});
  const [pagination, setPagination] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, pageCount: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [editingQuick, setEditingQuick] = useState(false);

  const debouncedSearch = useDebounce(search, 400);

  // Filters come from the address, so "back to tasks" returns to the same list
  useEffect(() => {
    const p = readParams();
    setView(p.view);
    setStatus(p.status);
    setFilter(p.filter);
    setSearch(p.search);
    setPage(p.page);
    setMine(p.mine);
    setMode(p.mode);
    setOpenId(p.open);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const set = (key: string, value: string | null) => (value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    set("view", view === "active" ? null : view);
    set("status", view === "active" && status !== "all" ? status : null);
    set("filter", filter);
    set("search", debouncedSearch || null);
    set("page", page > 1 ? String(page) : null);
    set("mytasks", mine ? "true" : null);
    set("mode", mode);
    set("open", openId);
    window.history.replaceState(window.history.state, "", url.toString());
    saveTaskListUrl(url.pathname + url.search);
    try {
      localStorage.setItem("taskViewMode", mode);
    } catch {
      // ignore
    }
  }, [ready, view, status, filter, debouncedSearch, page, mine, mode, openId]);

  // Keep the scroll position so coming back from a task returns to the same spot
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(saveTaskListScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const fetchTasks = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setDataError(null);
      try {
        const params = new URLSearchParams({ view, page: String(page), limit: String(PAGE_SIZE) });
        if (view === "active" && status !== "all") params.set("status", status);
        if (filter) params.set("filter", filter);
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (mine) params.set("assignedToMe", "true");
        const { data } = await axios.get(`/api/tasks?${params}`, { timeout: 20000 });
        setTasks(data.tasks);
        setPagination(data.pagination);
        setFollowUp(!!data.followUp);
        setViewCounts(data.viewCounts ?? {});
      } catch (error) {
        console.error("Error fetching tasks:", error);
        setDataError("Failed to load tasks. Please try again.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [view, status, filter, debouncedSearch, page, mine]
  );

  useEffect(() => {
    if (ready) fetchTasks();
  }, [ready, fetchTasks]);

  // After the first load, scroll back to where the user was on this list
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (!ready || loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const y = getTaskListScroll();
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [ready, loading]);

  // Changing what is listed starts again from the first page
  const changeView = (next: TaskView) => {
    setView(next);
    setPage(1);
    setFilter(null);
    setStatus("all");
  };
  const toggleFilter = (key: QuickFilterKey) => {
    setFilter((f) => (f === key ? null : key));
    setPage(1);
  };

  // The side panel: arrow keys move to the previous / next task in the list
  const openIndex = openId ? tasks.findIndex((t) => t.id === openId) : -1;
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      const next = tasks[openIndex + step];
      if (next) {
        e.preventDefault();
        setOpenId(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, openIndex, tasks]);

  const canEditTask = useCallback(
    (task: ListTask) => isAdmin || (session?.user?.role === "PARTNER" && session.user.id === task.assignedById),
    [isAdmin, session?.user]
  );

  const decide = async (task: ListTask, decision: "approve" | "reject") => {
    if (!task.pendingDeletion) return;
    try {
      await axios.patch(`/api/tasks/deletion-requests/${task.pendingDeletion.id}`, { decision });
      toast.success(decision === "approve" ? "Task deleted" : "Kept: the task is back in the list");
      if (openId === task.id && decision === "approve") setOpenId(null);
      fetchTasks(true);
    } catch (error) {
      toast.error(errorText(error, "Couldn't save the decision"));
    }
  };

  const views = useMemo(() => TASK_VIEWS.filter((v) => v !== "deletion" || isAdmin), [isAdmin]);

  const emptyText = debouncedSearch
    ? "No tasks match your search."
    : filter
      ? "No tasks with this filter."
      : view === "awaiting_bill"
        ? "No completed tasks are waiting for their bill."
        : view === "closed"
          ? "No closed tasks yet."
          : view === "deletion"
            ? "No deletion requests."
            : canManageTasks
              ? "No active tasks. Create one, or start from a template (ITR, GST notice, ROC …)."
              : "No tasks are assigned to you. New ones appear here and on Today, and you get a notification.";

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Task Management</h1>
            <HelpLink section="tasks" />
          </div>
          <p className="text-muted-foreground">Follow up work, see what waits for its bill, and close it</p>
        </div>
        {canManageTasks && (
          <div className="mt-2 flex w-full flex-col gap-2 sm:mt-0 sm:w-auto sm:flex-row">
            {isAdmin && (
              <Button variant="outline" onClick={() => setEditingQuick(true)}>
                <Settings2 className="mr-2 h-4 w-4" /> Quick comments
              </Button>
            )}
            <TaskExportButton />
            <TaskImportDialog onImported={() => fetchTasks(true)} />
            <Button onClick={() => router.push("/dashboard/tasks/create")} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Create Task
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="space-y-3 pb-3">
          {/* The views */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {views.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => changeView(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    view === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {VIEW_LABEL[v]}
                  {viewCounts[v] !== undefined && (
                    <span className={cn("ml-1.5 text-xs", v === "deletion" && viewCounts[v] ? "text-red-600" : "text-muted-foreground")}>
                      {viewCounts[v]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant={mode === "card" ? "default" : "outline"} size="sm" className="h-9 w-9 p-0" onClick={() => setMode("card")} aria-label="Card view">
                <Grid className="h-4 w-4" />
              </Button>
              <Button variant={mode === "table" ? "default" : "outline"} size="sm" className="h-9 w-9 p-0" onClick={() => setMode("table")} aria-label="Table view">
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Status (Active only), quick filters, mine, search */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {view === "active" &&
                ACTIVE_STATUSES.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant={status === s.key ? "secondary" : "ghost"}
                    className="h-8"
                    onClick={() => {
                      setStatus(s.key);
                      setPage(1);
                    }}
                  >
                    {s.label}
                  </Button>
                ))}
              {view === "active" && <span className="mx-1 hidden h-5 w-px bg-border sm:block" />}
              {(view === "active" ? QUICK_FILTERS : QUICK_FILTERS.filter((f) => f.key === "waiting_on_me" || f.key === "unanswered")).map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? "default" : "outline"}
                  className="h-8 rounded-full"
                  onClick={() => toggleFilter(f.key)}
                >
                  {f.label}
                  {filter === f.key && <X className="ml-1 h-3 w-3" />}
                </Button>
              ))}
              <div className="ml-1 flex items-center gap-2">
                <Switch
                  id="assigned-to-me"
                  checked={mine}
                  onCheckedChange={(checked) => {
                    setMine(checked);
                    setPage(1);
                  }}
                />
                <Label htmlFor="assigned-to-me" className="cursor-pointer text-sm">
                  Assigned to me
                </Label>
              </div>
            </div>
            <div className="relative w-full lg:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search title, description, client…"
                className="h-9 pl-8 pr-8"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              {refreshing ? (
                <RefreshCw className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                    <X className="h-4 w-4" />
                  </button>
                )
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : dataError ? (
            <div className="rounded-md border py-12 text-center">
              <ClipboardList className="mx-auto mb-2 h-10 w-10 text-muted-foreground opacity-20" />
              <p className="mb-4 text-muted-foreground">{dataError}</p>
              <Button onClick={() => fetchTasks()} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Try again
              </Button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-md border py-12 text-center">
              <ClipboardList className="mx-auto mb-2 h-10 w-10 text-muted-foreground opacity-20" />
              <p className="mb-4 text-muted-foreground">{emptyText}</p>
              {canManageTasks && view === "active" && !filter && !debouncedSearch && (
                <Button asChild>
                  <Link href="/dashboard/tasks/create">Create New Task</Link>
                </Button>
              )}
            </div>
          ) : mode === "card" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  view={view}
                  selected={task.id === openId}
                  followUp={followUp}
                  isAdmin={isAdmin}
                  canEdit={canEditTask(task)}
                  onOpen={() => setOpenId(task.id)}
                  onCommented={() => fetchTasks(true)}
                  onDecide={(d) => decide(task, d)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border">
              <ResponsiveTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="hidden md:table-cell">Last activity</TableHead>
                      <TableHead className="hidden md:table-cell">{view === "active" ? "Waiting on" : "Bill"}</TableHead>
                      {followUp && <TableHead className="hidden lg:table-cell">Last comment</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => {
                      const last = task.recentComments?.[task.recentComments.length - 1];
                      return (
                        <TableRow
                          key={task.id}
                          className={cn("cursor-pointer", task.id === openId && "bg-muted")}
                          onClick={() => setOpenId(task.id)}
                        >
                          <TableCell>
                            <p className="font-medium">{task.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {clientName(task.client) ?? ""}
                              {task.awaitingMyReply && <span className="ml-1 text-amber-700 dark:text-amber-400">· your reply</span>}
                            </p>
                          </TableCell>
                          <TableCell>
                            <StatusBadge task={task} />
                          </TableCell>
                          <TableCell className={cn("whitespace-nowrap text-sm", isOverdue(task) && "text-red-600")}>
                            {task.dueDate ? format(new Date(task.dueDate), "dd MMM yyyy") : "—"}
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                            {task.lastActivity.text}, {ago(task.lastActivity.at)}
                          </TableCell>
                          <TableCell className="hidden text-xs md:table-cell">
                            {view === "active"
                              ? task.waitingOn.join(", ") || "—"
                              : task.billStage
                                ? BILL_STAGE_LABEL[task.billStage] ?? task.billStage
                                : "—"}
                          </TableCell>
                          {followUp && (
                            <TableCell className="hidden max-w-xs truncate text-xs lg:table-cell" title={last?.content}>
                              {last ? (
                                <>
                                  <MessageSquare className="mr-1 inline h-3 w-3" />
                                  {last.user.name.split(" ")[0]}: {last.content}
                                </>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ResponsiveTable>
            </div>
          )}
        </CardContent>

        {!loading && !dataError && tasks.length > 0 && (
          <CardFooter className="flex-col gap-2 border-t py-3 sm:flex-row">
            <div className="flex-1 text-sm text-muted-foreground">
              {pagination.total} task{pagination.total === 1 ? "" : "s"} · showing {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.total)}
              {followUp && " · click a card to open it; ← → move between tasks"}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                {pagination.page} / {Math.max(pagination.pageCount, 1)}
              </span>
              <Button variant="outline" size="sm" className="h-8" disabled={page >= pagination.pageCount} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => fetchTasks(true)} disabled={refreshing} className="h-8 gap-1">
                <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Refresh
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-3xl">
          <SheetHeader className="p-0">
            <SheetTitle className="flex items-center justify-between gap-2 pr-8 text-sm font-normal text-muted-foreground">
              <span>{openIndex >= 0 ? `Task ${openIndex + 1} of ${tasks.length} on this page` : "Task"}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7" disabled={openIndex <= 0} onClick={() => setOpenId(tasks[openIndex - 1]?.id ?? openId)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={openIndex < 0 || openIndex >= tasks.length - 1}
                  onClick={() => setOpenId(tasks[openIndex + 1]?.id ?? openId)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">The task&apos;s details and discussion</SheetDescription>
          </SheetHeader>
          {openId && (
            <TaskDetailView
              key={openId}
              taskId={openId}
              embedded
              onChanged={(change) => {
                if (change === "deleted") setOpenId(null);
                fetchTasks(true);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <QuickCommentsEditor open={editingQuick} onClose={() => setEditingQuick(false)} />
    </div>
  );
}

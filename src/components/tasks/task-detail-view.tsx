"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import Link from "next/link"; // Add this import for Link
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label"; // Add this import for Label
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"; // Add this import for Avatar components
import {
  ArrowLeftIcon,
  PencilIcon as Edit, // Rename to Edit for clarity
  Loader2,
  UserPlus,
  ListTodo, // Add this import for ListTodo
  CheckCircle,
  Receipt,
  Download,
  ClipboardCheck,
  Trash2,
  MessageSquareReply,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BILL_STAGE_LABEL, followsUpTasks } from "@/lib/task-views";
import { useNotifications } from "@/components/notifications/notification-system";
import { StartComplianceDialog, isRegistrationTask } from "@/components/compliance/start-compliance-dialog";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskDetailSkeleton } from "@/components/loading/task-skeleton";
import { TaskAssignees } from "@/components/tasks/task-assignees";
import { generateAndDownloadTaskPdf } from "@/lib/task-pdf-generate";
import { getTaskListUrl } from "@/lib/task-list-state";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CompanyBadge } from "@/components/billing/company-select";

// Add the missing getInitials function
// Add null safety to the getInitials function
const getInitials = (name?: string): string => {
  if (!name) return "??"; // Return placeholder if name is undefined/null
  
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
};

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

// Fix any types
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  canApproveBilling?: boolean;
}

// Update Task interface to include assignees
interface TaskAssignee {
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  billingStatus?: string; // Add billingStatus 
  company?: "MVC" | "BEDGE";
  // Add these new fields
  lastStatusUpdatedAt?: string;
  lastStatusUpdatedBy?: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar?: string;
  };
  assignedBy: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar?: string; // Add optional avatar property
  };
  assignedTo: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  // Add assignees array
  assignees: TaskAssignee[];
  client: {
    id: string;
    contactPerson: string;
    companyName: string | null;
  } | null;
  bill?: { status: string } | null;
  deletionRequests?: PendingDeletion[];
  replyRequests?: { createdAt: string; requestedBy: { name: string }; comment: { content: string } }[];
}

export interface PendingDeletion {
  id: string;
  reason: string | null;
  createdAt: string;
  requestedBy: { id: string; name: string };
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  user: User;
}

// Add these helper functions to control permissions
const canEditTask = (task: Task, currentUser: User) => {
  if (!currentUser) return false;

  // Admin can edit all tasks
  if (currentUser.role === "ADMIN") return true;

  // Creator can edit their own tasks
  if (task.assignedBy?.id === currentUser.id) return true;

  // Assignee can edit their assigned task
  if (task.assignees?.some((a) => a.userId === currentUser.id)) return true;

  // No one else can edit tasks
  return false;
};

const canReassignTask = (currentUser: User) => {
  if (!currentUser) return false;
  return currentUser.role === "ADMIN" || currentUser.role === "PARTNER";
};

// Add this helper function near the other permission functions
const isTaskEditable = (task, billingStatus) => {
  // Task is not editable if billing is approved
  if (billingStatus === "billed") {
    return false;
  }
  return true;
};

// The task page (/dashboard/tasks/[id]), also shown in the side panel of the
// task list (embedded). onChanged tells the list that the task changed or
// was deleted.
export function TaskDetailView({
  taskId,
  embedded = false,
  onChanged,
}: {
  taskId: string;
  embedded?: boolean;
  onChanged?: (change: "updated" | "deleted") => void;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  // The signed-in user comes from the session (no separate /api/users/me request)
  const currentUser = useMemo(() => {
    const user = session?.user as
      | (NonNullable<typeof session>["user"] & { canApproveBilling?: boolean })
      | undefined;
    if (!user?.id) return null;
    return {
      id: user.id,
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role,
      avatar: user.avatar ?? undefined,
      canApproveBilling: user.canApproveBilling ?? false,
    };
  }, [session?.user]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<string | null>(null);

  // Add a state variable to track billing status changes
  const [currentBillingStatus, setCurrentBillingStatus] = useState(
    task?.billingStatus
  );

  // Memoized data fetching 
  const fetchTask = useCallback(async () => {
    try {
      setLoading(true);
      // One request for the task and its comments
      const response = await axios.get<Task & { comments?: Comment[] }>(
        `/api/tasks/${taskId}?include=comments`
      );
      const { comments: taskComments, ...taskData } = response.data;
      setTask(taskData);
      setComments(taskComments ?? []);
      setNewStatus(taskData.status);
      setCurrentBillingStatus(taskData.billingStatus);
      return taskData;
    } catch (error) {
      console.error("Error fetching task:", error);
      
      // Handle permission error specifically
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        toast.error("You don't have permission to view this task");
        // Redirect to tasks list after a short delay
        setTimeout(() => router.push(getTaskListUrl()), 1500);
      } else {
        toast.error("Failed to load task details");
      }
    } finally {
      setLoading(false);
      setCommentsLoading(false);
    }
  }, [taskId, router]);

  useEffect(() => {
    if (taskId) {
      fetchTask();
    }
  }, [fetchTask, taskId]);

  // The server clears this task's notifications when it is opened; take
  // them off the bell here too, without waiting for its next refresh
  const { notifications, markTaskAsRead } = useNotifications();
  const loadedId = task?.id;
  useEffect(() => {
    if (loadedId && notifications.some((n) => n.taskId === loadedId)) markTaskAsRead(loadedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened task
  }, [loadedId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-gray-500 hover:bg-gray-600";
      case "in_progress":
        return "bg-blue-500 hover:bg-blue-600";
      case "review":
        return "bg-yellow-500 hover:bg-yellow-600";
      case "completed":
        return "bg-green-500 hover:bg-green-600";
      case "cancelled":
        return "bg-red-500 hover:bg-red-600";
      default:
        return "bg-gray-500 hover:bg-gray-600";
    }
  };

  // Use useMemo where appropriate
  const statusColor = useMemo(
    () => getStatusColor(task?.status || "pending"),
    [task?.status]
  );

  const [startCompliance, setStartCompliance] = useState(false);
  const canStartCompliance = isAdmin || session?.user?.role === "PARTNER";

  const updateTaskStatus = async (target?: string, isUndo = false) => {
    const nextStatus = target ?? newStatus;
    // An undo runs from the toast with the task as it was before the change
    if (!nextStatus || (!isUndo && nextStatus === task?.status)) return;
    const previousStatus = task?.status;

    try {
      setUpdating(true);
      // Make the API call and store the response
      const response = await axios.patch(`/api/tasks/${taskId}/status`, {
        status: nextStatus,
        ...(isUndo && { undo: true }),
      });
      onChanged?.("updated");
  
      // Update the task with ALL the updated data from the response
      // This will include lastStatusUpdatedBy and lastStatusUpdatedAt
      setTask((prev) => prev ? { 
        ...prev, 
        status: nextStatus,
        lastStatusUpdatedBy: response.data.lastStatusUpdatedBy || currentUser,
        lastStatusUpdatedAt: new Date().toISOString()
      } : null);
      
      setNewStatus(nextStatus);
      if (isUndo) {
        toast.success("Status change undone");
      } else {
        // A few seconds to take back a wrong click (a completed task's bill is
        // withdrawn again and billing is not told)
        toast.success(`Status changed to ${nextStatus.replace("_", " ")}`, {
          duration: 7000,
          action: previousStatus
            ? { label: "Undo", onClick: () => updateTaskStatus(previousStatus, true) }
            : undefined,
        });
      }
      // A finished registration: offer to put the client into Compliance
      if (!isUndo && nextStatus === "completed" && task?.client && canStartCompliance && isRegistrationTask(task.title)) {
        setStartCompliance(true);
      }
    } catch (error) {
      console.error("Error updating task:", error);
      toast.error(errorText(error, "Failed to update task status"));
    } finally {
      setUpdating(false);
    }
  };

  // Deleting: Admin deletes at once (a reason is optional); anyone else on
  // the task asks Admin with a reason. A task with a bill can't be deleted.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const pendingDeletion = task?.deletionRequests?.[0] ?? null;
  const onTask =
    !!session?.user &&
    !!task &&
    (isAdmin || task.assignedBy?.id === session.user.id || task.assignees.some((a) => a.userId === session.user.id));
  const hasBill = !!task?.bill;

  const submitDeletion = async () => {
    if (!task) return;
    if (!isAdmin && deleteReason.trim().length < 5) {
      toast.error("Say why the task should be deleted");
      return;
    }
    setDeleting(true);
    try {
      if (isAdmin) {
        await axios.delete(`/api/tasks/${task.id}`, { data: { reason: deleteReason.trim() || undefined } });
        toast.success("Task deleted");
        setDeleteOpen(false);
        onChanged?.("deleted");
        if (!embedded) router.push(getTaskListUrl());
      } else {
        await axios.post(`/api/tasks/${task.id}/deletion-request`, { reason: deleteReason.trim() });
        toast.success("Sent to Admin for approval");
        setDeleteOpen(false);
        setDeleteReason("");
        onChanged?.("updated");
        fetchTask();
      }
    } catch (error) {
      toast.error(errorText(error, "Couldn't delete the task"));
    } finally {
      setDeleting(false);
    }
  };

  const decideDeletion = async (decision: "approve" | "reject") => {
    if (!pendingDeletion || !task) return;
    setDeleting(true);
    try {
      await axios.patch(`/api/tasks/deletion-requests/${pendingDeletion.id}`, { decision });
      if (decision === "approve") {
        toast.success("Task deleted");
        onChanged?.("deleted");
        if (!embedded) router.push(getTaskListUrl());
      } else {
        toast.success("Kept: the task is back in the list");
        onChanged?.("updated");
        fetchTask();
      }
    } catch (error) {
      toast.error(errorText(error, "Couldn't save the decision"));
    } finally {
      setDeleting(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "low":
        return "bg-green-500 hover:bg-green-600";
      case "medium":
        return "bg-yellow-500 hover:bg-yellow-600";
      case "high":
        return "bg-red-500 hover:bg-red-600";
      default:
        return "bg-gray-500 hover:bg-gray-600";
    }
  };

  // Update the existing canEditTask function call to include billing status check
  const taskEditableStatus = useMemo(
    () =>
      task && session?.user
        ? isTaskEditable(task, currentBillingStatus) &&
          canEditTask(task, session.user as User)
        : false,
    [task, currentBillingStatus, session?.user]
  );

  if (loading) {
    return <TaskDetailSkeleton />;
  }

  if (!task) {
    return (
      <div className="container py-10">
        <div className="flex justify-center items-center h-64">
          <div className="text-xl">Task not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "py-2" : "container py-6"}>
      {/* Back button and title */}
      {!embedded && (
        <div className="mb-6">
          <Button
            variant="outline"
            size="sm"
            className="mb-4"
            onClick={() => router.push(getTaskListUrl())}
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" /> Back to Tasks
          </Button>
        </div>
      )}

      {pendingDeletion && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
          <p className="font-medium text-red-800 dark:text-red-300">
            Deletion requested by {pendingDeletion.requestedBy.name}{" "}
            <span className="font-normal text-muted-foreground">
              {formatDistanceToNow(new Date(pendingDeletion.createdAt), { addSuffix: true })}
            </span>
          </p>
          {pendingDeletion.reason && <p className="mt-1">Reason: {pendingDeletion.reason}</p>}
          {isAdmin ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={deleting || hasBill} onClick={() => decideDeletion("approve")}>
                {deleting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Approve – delete
              </Button>
              <Button size="sm" variant="outline" disabled={deleting} onClick={() => decideDeletion("reject")}>
                Reject – keep the task
              </Button>
              {hasBill && <p className="w-full text-xs text-muted-foreground">This task has a bill; deal with the bill in Billing first.</p>}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Waiting for Admin. The task can&apos;t be changed until then.</p>
          )}
        </div>
      )}

      {!!task.replyRequests?.length && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
            <MessageSquareReply className="h-4 w-4" /> Your reply is needed
          </p>
          {task.replyRequests.map((r, i) => (
            <p key={i} className="mt-1">
              {r.requestedBy.name}: &ldquo;{r.comment.content.slice(0, 200)}&rdquo;{" "}
              <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span>
            </p>
          ))}
          <p className="mt-1 text-xs text-muted-foreground">Reply in the discussion below.</p>
        </div>
      )}

      <div className={embedded ? "flex flex-col gap-4" : "grid grid-cols-1 lg:grid-cols-3 gap-6 lg:grid-flow-row-dense"}>
        {/* Task details - Left column */}
        <div className="lg:col-span-2 h-auto flex flex-col">
          <Card className="h-full flex-grow">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl">{task.title}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge className={statusColor}>{task.status}</Badge>
                    <CompanyBadge company={task.company} />
                    <Badge
                      variant="outline"
                      className={getPriorityColor(task.priority)}
                    >
                      {task.priority}
                    </Badge>
                    {task.dueDate && (
                      <Badge
                        variant="outline"
                        className={
                          new Date(task.dueDate) < new Date() &&
                          task.status !== "completed"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                            : ""
                        }
                      >
                        Due: {format(new Date(task.dueDate), "MMM dd, yyyy")}
                      </Badge>
                    )}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      // Always show loading state
                      const toastId = toast.loading("Preparing PDF...");

                      // Always fetch fresh comments for PDF to ensure we have the latest
                      const response = await axios.get(
                        `/api/tasks/${taskId}/comments`
                      );
                      const commentData = response.data;

                      // Add this console log to debug
                      console.log(
                        "Comments for PDF:",
                        commentData.length,
                        commentData
                      );

                      // Generate PDF with the freshly fetched comments
                      generateAndDownloadTaskPdf(task, commentData);

                      // Update state for future use
                      setComments(commentData);

                      // Show success message
                      toast.success("PDF generated!!", { id: toastId });
                    } catch (error) {
                      console.error("Error generating PDF:", error);
                      toast.error("Failed to generate PDF");
                    }
                  }}
                  disabled={commentsLoading}
                >
                  {commentsLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Preparing...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Task description */}
              <div>
                <h3 className="text-sm font-medium mb-2">Description</h3>
                <div className="text-sm text-muted-foreground">
                  {task.description ? (
                    <p className="whitespace-pre-wrap">{task.description}</p>
                  ) : (
                    <p>No description provided</p>
                  )}
                </div>
              </div>

              {/* Task metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <h3 className="text-sm font-medium mb-1">Assigned By</h3>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage
                        src={
                          task.assignedBy.avatar ||
                          `https://api.dicebear.com/7.x/initials/svg?seed=${task.assignedBy.name}`
                        }
                        alt={task.assignedBy.name}
                      />
                      <AvatarFallback>
                        {getInitials(task.assignedBy.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-sm">{task.assignedBy.name}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-1">Assigned To</h3>
                  <TaskAssignees
                    assignees={task.assignees}
                    legacyAssignedTo={task.assignedTo}
                    showDetails={false}
                    showTooltip={true}
                    size="md"
                  />
                </div>

                {task.client && (
                  <div>
                    <h3 className="text-sm font-medium mb-1">Client</h3>
                    <Link
                      href={`/dashboard/clients/${task.client.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {task.client.contactPerson}
                      {task.client.companyName &&
                        ` (${task.client.companyName})`}
                    </Link>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium mb-1">Created</h3>
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(task.createdAt), "MMM dd, yyyy")}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Task actions - Right column */}
        <div className="h-auto flex flex-col">
          {/* Status update card */}
          <Card className="h-full flex-grow">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Task Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status update dropdown */}
              <div className="space-y-2">
                <Label htmlFor="status">Update Status</Label>
                <Select
                  value={newStatus || task.status}
                  onValueChange={setNewStatus}
                  disabled={updating || currentBillingStatus === "billed" || !!pendingDeletion}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    {task.status === "cancelled" && (
                      <SelectItem value="cancelled" disabled>Cancelled (old)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => updateTaskStatus()}
                disabled={
                  !newStatus ||
                  newStatus === task.status ||
                  updating ||
                  currentBillingStatus === "billed" ||
                  !!pendingDeletion
                }
                className="w-full"
              >
                {updating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update Status"
                )}
              </Button>

              {/* Add this section to show last status update info */}
{/* Status update info with improved layout */}
{task.lastStatusUpdatedBy && task.lastStatusUpdatedAt && (
  <div className="flex items-center gap-2 px-2 py-2 bg-muted/30 rounded-md text-sm">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Avatar className="h-6 w-6">
            <AvatarImage
              src={
                task.lastStatusUpdatedBy.avatar ||
                `https://api.dicebear.com/7.x/initials/svg?seed=${task.lastStatusUpdatedBy.name}`
              }
              alt={task.lastStatusUpdatedBy.name}
            />
            <AvatarFallback>{getInitials(task.lastStatusUpdatedBy.name)}</AvatarFallback>
          </Avatar>
        </TooltipTrigger>
        <TooltipContent>
          <p>{task.lastStatusUpdatedBy.name}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    
    <span className="text-sm text-muted-foreground">
      Last updated: {format(new Date(task.lastStatusUpdatedAt), "MMM d, h:mm a")}
    </span>
  </div>
)}

              {/* Action buttons */}
              <div className="pt-4 space-y-3 border-t">
                {session?.user &&
                  isTaskEditable(task, currentBillingStatus) &&
                  (session.user.role === "ADMIN" ||
                    task.assignedBy?.id === session.user.id) && (
                    <Button
                      variant="outline"
                      className="w-full"
                      asChild
                      disabled={currentBillingStatus === "billed"}
                    >
                      <Link href={`/dashboard/tasks/${task.id}/edit`}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Task
                      </Link>
                    </Button>
                  )}

                {session?.user &&
                  canReassignTask(session.user as User) &&
                  currentBillingStatus !== "billed" && (
                    <Button variant="outline" className="w-full" asChild>
                      <Link href={`/dashboard/tasks/${task.id}/reassign`}>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Reassign Task
                      </Link>
                    </Button>
                  )}

                {embedded ? (
                  <Button variant="outline" className="w-full" asChild>
                    <Link href={`/dashboard/tasks/${task.id}`}>
                      <ListTodo className="mr-2 h-4 w-4" />
                      Open full page
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" asChild>
                    <Link href={getTaskListUrl()}>
                      <ListTodo className="mr-2 h-4 w-4" />
                      View All Tasks
                    </Link>
                  </Button>
                )}

                {onTask && !pendingDeletion && (
                  <div className="space-y-1">
                    <Button
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive"
                      disabled={hasBill}
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {isAdmin ? "Delete task" : "Request deletion"}
                    </Button>
                    {hasBill && (
                      <p className="text-xs text-muted-foreground">
                        This task has a bill ({BILL_STAGE_LABEL[task.bill?.status ?? "none"] ?? task.bill?.status}), so it can&apos;t be deleted.
                        {task.status === "completed" ? " Reopen it (an untouched draft bill is removed) or deal with the bill in Billing." : " Deal with the bill in Billing first."}
                      </p>
                    )}
                  </div>
                )}

                {task.status === "completed" &&
                  currentBillingStatus !== "billed" &&
                  (isAdmin || session?.user?.role === "PARTNER") && (
                    <div className="mt-4">
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-md dark:bg-amber-950/30 dark:border-amber-900">
                        <div className="flex items-start gap-3">
                          <Receipt className="h-5 w-5 text-amber-600 mt-0.5" />
                          <div>
                            <h3 className="font-medium">Billing</h3>
                            <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
                              This task is completed. Its bill is handled on the Billing page.
                            </p>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/dashboard/billing?tab=${task.company === "BEDGE" ? "bedge" : "mvc"}`}>
                                Open Billing
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                {task.status === "completed" && task.client && canStartCompliance && (
                  <div className="mt-4 rounded-md border p-3">
                    <h3 className="font-medium">Compliance</h3>
                    <p className="mb-3 text-sm text-muted-foreground">
                      A registration done? Put the client into Compliance (GST returns, TDS and other recurring work).
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setStartCompliance(true)}>
                      <ClipboardCheck className="mr-1 h-4 w-4" /> Start compliance
                    </Button>
                  </div>
                )}

                {task.status === "completed" && !task.client && canStartCompliance && isRegistrationTask(task.title) && (
                  <div className="mt-4 rounded-md border p-3">
                    <h3 className="font-medium">Compliance</h3>
                    <p className="mb-3 text-sm text-muted-foreground">
                      This registration has no client. Add the new business as a client, then add its work in Compliance → Clients.
                    </p>
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/dashboard/clients/create">Create the client</Link>
                    </Button>
                  </div>
                )}

                {task.status === "completed" &&
                  currentBillingStatus === "billed" && (
                    <div className="mt-4">
                      <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5 text-green-500" />
                          <p className="text-sm text-green-700 font-medium">
                            This task has been completed and billed
                          </p>
                        </div>
                        <p className="text-xs text-green-600 mt-1">
                          Task details have been saved to client history and
                          this task is now locked for editing.
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Comments section - Full width */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Discussion</CardTitle>
              <CardDescription>
                Add comments or notes about this task
              </CardDescription>
            </CardHeader>
            <CardContent>
              {commentsLoading ? (
                <div className="flex flex-col items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Loading comments...
                  </p>
                </div>
              ) : currentUser ? (
                <TaskComments
                  taskId={taskId}
                  comments={comments}
                  currentUser={currentUser}
                  canAskReply={followsUpTasks(session?.user)}
                  onCommented={() => {
                    if (task.replyRequests?.length) setTask((t) => (t ? { ...t, replyRequests: [] } : t));
                    onChanged?.("updated");
                  }}
                />
              ) : null}
            </CardContent>
            <CardFooter className="border-t pt-4">
              {/* Comment form will go here */}
            </CardFooter>
          </Card>
        </div>
      </div>
      <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAdmin ? "Delete this task?" : "Request deletion"}</DialogTitle>
            <DialogDescription>
              {isAdmin
                ? "The task, its comments and attachments are deleted at once. A line with the title and reason is kept."
                : "Admin is asked to approve. Until then the task stays in the list, marked, and can't be changed."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-reason">Reason{isAdmin ? " (optional)" : " *"}</Label>
            <Textarea
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Created twice; the client dropped the work"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitDeletion} disabled={deleting || (!isAdmin && deleteReason.trim().length < 5)}>
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {isAdmin ? "Delete" : "Send to Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {startCompliance && task.client && (
        <StartComplianceDialog
          client={{ id: task.client.id, name: task.client.companyName || task.client.contactPerson }}
          taskTitle={task.title}
          onClose={() => setStartCompliance(false)}
        />
      )}
    </div>
  );
}

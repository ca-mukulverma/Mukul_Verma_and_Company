import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  Calendar, 
  CheckCircle, 
  ExternalLink,
  Clock
} from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  assignedTo?: { 
    name: string;
    avatar?: string;
  } | null;
  assignees?: Array<{
    user: {
      id: string;
      name: string;
      avatar?: string;
    }
  }>;
}

interface PriorityTasksCardProps {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  className?: string;
}

// Helper function to check if a task is overdue
const isOverdue = (dueDate: string | null | undefined): boolean => {
  if (!dueDate) return false;
  
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  const taskDate = new Date(dueDate);
  taskDate.setHours(0, 0, 0, 0);
  
  return taskDate < now;
};

export function PriorityTasksCard({ tasks, loading, error, className }: PriorityTasksCardProps) {
  // Filter for high priority tasks OR overdue tasks
  const priorityTasks = tasks?.filter(task => 
    task.priority.toLowerCase() === "high" || 
    (task.dueDate && isOverdue(task.dueDate) && task.status !== "completed")
  ) || [];
  
  // Sort: overdue first, then by priority, then by due date (closest first)
  const sortedTasks = priorityTasks.sort((a, b) => {
    // First prioritize overdue tasks
    const aIsOverdue = a.dueDate && isOverdue(a.dueDate);
    const bIsOverdue = b.dueDate && isOverdue(b.dueDate);
    
    if (aIsOverdue && !bIsOverdue) return -1;
    if (!aIsOverdue && bIsOverdue) return 1;
    
    // Then prioritize high priority tasks
    if (a.priority.toLowerCase() === "high" && b.priority.toLowerCase() !== "high") return -1;
    if (a.priority.toLowerCase() !== "high" && b.priority.toLowerCase() === "high") return 1;
    
    // Then sort by due date (if available)
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    
    return 0;
  });

  // Get assignee information consistently from either structure
  const getAssigneeInfo = (task: Task) => {
    // Check assignedTo first (direct assignment)
    if (task.assignedTo) {
      return {
        name: task.assignedTo.name,
        avatar: task.assignedTo.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${task.assignedTo.name}`
      };
    }
    
    // Check assignees array with proper null checks
    if (task.assignees && task.assignees.length > 0 && task.assignees[0]?.user) {
      const assignee = task.assignees[0].user;
      return {
        name: assignee.name,
        avatar: assignee.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${assignee.name}`
      };
    }
    
    return null;
  };

  return (
    <Card className={`h-[350px] flex flex-col overflow-hidden ${className}`}>
      <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800/50">
        <CardTitle className="flex items-center text-slate-800 dark:text-slate-200">
          <AlertTriangle className="h-5 w-5 mr-2 text-amber-600 dark:text-amber-400" />
          Priority Tasks
        </CardTitle>
        <CardDescription className="text-slate-500 dark:text-slate-400">
          Tasks requiring immediate attention
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pt-4 overflow-hidden flex flex-col">
        {loading ? (
          <div className="space-y-3 flex-1">
            <Skeleton className="h-[70px] w-full" />
            <Skeleton className="h-[70px] w-full" />
            <Skeleton className="h-[70px] w-full" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mb-2 opacity-20" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : sortedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center h-full bg-slate-50/50 dark:bg-slate-900/20 rounded-lg border border-dashed border-slate-200 dark:border-slate-800/50">
            <div className="bg-slate-100 dark:bg-slate-800/50 p-3 rounded-full mb-3">
              <CheckCircle className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No priority tasks
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-[220px]">
              All tasks have appropriate priorities and are on schedule
            </p>
          </div>
        ) : (
          <div className="h-full max-h-[260px] overflow-y-auto pr-1 space-y-3 custom-scrollbar">
            {sortedTasks.slice(0, 5).map((task) => {
              const isTaskOverdue = task.dueDate && isOverdue(task.dueDate);
              const assignee = getAssigneeInfo(task);
              
              return (
                <div key={task.id} className={`p-3 rounded-md bg-white dark:bg-gray-950/50 border border-transparent 
                  ${isTaskOverdue 
                    ? 'hover:border-rose-100 dark:hover:border-rose-950/70' 
                    : 'hover:border-amber-100 dark:hover:border-amber-950/70'} 
                  hover:shadow-sm transition-all group`}
                >
                  {/* Clickable title section */}
                  <div 
                    onClick={() => window.location.href = `/dashboard/tasks/${task.id}`} 
                    className="cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-sm text-slate-800 dark:text-slate-200 line-clamp-1">
                        {task.title}
                      </span>
                      
                      {isTaskOverdue ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800/50 flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Overdue
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/50">
                          High Priority
                        </Badge>
                      )}
                    </div>
                    
                    {task.dueDate && (
                      <div className="flex justify-between items-center mt-3">
                        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>
                            {format(new Date(task.dueDate), 'MMM d, yyyy')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {assignee ? (
                        <div className="flex items-center gap-1">
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={assignee.avatar} />
                            <AvatarFallback className="text-[10px]">
                              {assignee.name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {assignee.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Unassigned
                        </span>
                      )}
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/50"
                      onClick={() => window.location.href = `/dashboard/tasks/${task.id}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      <span className="text-xs">View</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
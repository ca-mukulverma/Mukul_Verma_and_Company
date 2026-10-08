"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Receipt, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTaskListUrl } from "@/lib/task-list-state";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BillingApprovalButtonProps {
  taskId: string;
  className?: string;
  onApproved?: () => void;
}

export function BillingApprovalButton({
  taskId,
  className,
  onApproved,
}: BillingApprovalButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const router = useRouter();

  const handleApprove = async () => {
    console.log(`🧾 Approving billing for task ${taskId}`);
    setIsSubmitting(true);
    
    try {
      const approvalResponse = await fetch(`/api/tasks/${taskId}/billing-approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!approvalResponse.ok) {
        const errorData = await approvalResponse.json();
        throw new Error(errorData.error || "Failed to approve billing");
      }

      // Success handling
      const data = await approvalResponse.json();
      console.log("Billing approved successfully:", data);
      
      // Call the onApproved callback if provided
      if (onApproved) {
        onApproved();
      }
      
      // Close the dialog
      setConfirmDialogOpen(false);
      
      // Redirect to the tasks page after successful billing approval
      router.push(getTaskListUrl());
      
    } catch (error) {
      console.error("Error in approval process:", error);
      toast.error("Error in approval process");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "flex items-center gap-1 text-green-700 bg-green-50 hover:bg-green-100 hover:text-green-800",
          className
        )}
        onClick={() => setConfirmDialogOpen(true)}
        disabled={isSubmitting}
      >
        <Receipt className="h-4 w-4" />
        Approve Billing
      </Button>

      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Billing</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve this client's billing?
              The task and its comments will be deleted. If you need a copy,
              use &quot;Download PDF&quot; on the task page first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-2">
            <div className="mb-2">This will:</div>
            <ul className="list-disc pl-5">
              <li>Mark the task as billed</li>
              <li>Add an entry to the client's billing history</li>
              <li>Delete the task immediately</li>
            </ul>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApprove}
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
import { escapeHtml, staffEmail } from "./layout";

const dueText = (dueDate?: Date | null) =>
  dueDate ? new Date(dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "No due date";

export function getTaskAssignmentTemplate(taskTitle: string, assignerName: string, note?: string, dueDate?: Date | null): string {
  return staffEmail({
    paragraphs: ["A task has been assigned to you. Its details are given below."],
    details: [
      ["Task", taskTitle],
      ["Assigned by", assignerName],
      ["Due date", dueText(dueDate)],
      ...(note ? ([["Note", note]] as [string, string][]) : []),
    ],
    footnote: "Please sign in to the office app to see the full task.",
  });
}

export function getTaskReassignedTemplate(taskTitle: string, newAssigneeName: string): string {
  return staffEmail({
    paragraphs: [`The task “${escapeHtml(taskTitle)}” has been reassigned to ${escapeHtml(newAssigneeName)}. No further action is needed from you on it.`],
  });
}

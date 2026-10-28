// Where a notification leads when clicked, worked out from what it is about.
// Notifications have no link column, so this goes by the task reference and
// the wording of the title.

export function notificationLink(n: { title: string; content?: string | null; taskId?: string | null }): string | null {
  const taskId = n.taskId || n.content?.match(/\[taskId:\s*([a-f0-9-]+)\]/i)?.[1];
  if (taskId) return `/dashboard/tasks/${taskId}`;
  const title = n.title.toLowerCase();
  if (title.startsWith("your day")) return "/dashboard/my-work";
  if (title.includes("awaiting your amount")) return "/dashboard/billing?tab=amounts";
  if (title.includes("final approval")) return "/dashboard/billing?tab=final";
  if (title.includes("bill") || title.includes("work logged") || title.includes("tally")) return "/dashboard/billing";
  if (title.includes("compliance") || title.includes("return") || title.includes("gst") || title.includes("tds")) {
    return "/dashboard/compliance";
  }
  if (title.includes("chat") || title.includes("message")) return "/dashboard/chat";
  if (title.includes("profile") || title.includes("role") || title.includes("permission")) return "/dashboard/settings/profile";
  return null;
}

// The text without the internal "[taskId: …]" markers
export function notificationText(content: string | null | undefined) {
  return (content || "").replace(/\[(taskId|clientId):\s*[a-f0-9-]+\]/gi, "").replace(/\s{2,}/g, " ").trim();
}

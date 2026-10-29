import { escapeHtml, staffEmail } from "./layout";

export function getActivityNotificationTemplate(name: string, activityTitle: string, activityDetails: string, dashboardUrl?: string): string {
  return staffEmail({
    greetingName: name,
    paragraphs: [`<b>${escapeHtml(activityTitle)}</b>`, escapeHtml(activityDetails)],
    ...(dashboardUrl && { button: { label: "Open the office app", url: dashboardUrl } }),
  });
}

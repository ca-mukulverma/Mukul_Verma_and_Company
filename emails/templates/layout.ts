// The look of every email the app sends to staff (account, password, tasks):
// the same plain, professional layout as client emails (src/lib/email-layout.ts).

export const FIRM_NAME = "Mukul Verma & Company";
export const APP_NAME = "MV Company";

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const P = "margin:0 0 14px 0;";

export function staffEmail(input: {
  greetingName?: string | null;
  // Already escaped HTML
  paragraphs: string[];
  details?: [string, string][];
  button?: { label: string; url: string };
  footnote?: string;
}): string {
  const details = input.details?.length
    ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:0 0 14px 0;">${input.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#555555;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:4px 0;vertical-align:top;">${escapeHtml(v)}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const button = input.button
    ? `<p style="margin:22px 0;"><a href="${escapeHtml(input.button.url)}" style="background:#1f3a5f;color:#ffffff;padding:11px 20px;text-decoration:none;border-radius:4px;font-weight:bold;display:inline-block;">${escapeHtml(input.button.label)}</a></p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:600px;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222222;">
<p style="margin:0 0 16px 0;padding-bottom:8px;border-bottom:2px solid #1f3a5f;font-size:16px;font-weight:bold;color:#1f3a5f;">${FIRM_NAME}</p>
<p style="${P}">Dear ${escapeHtml(input.greetingName?.trim() || "Colleague")},</p>
${input.paragraphs.map((p) => `<p style="${P}">${p}</p>`).join("\n")}
${details}
${button}
${input.footnote ? `<p style="${P}color:#555555;font-size:13px;">${escapeHtml(input.footnote)}</p>` : ""}
<p style="margin:0 0 18px 0;">Regards,<br><b>${FIRM_NAME}</b></p>
<p style="margin:0;padding-top:8px;border-top:1px solid #e5e5e5;color:#888888;font-size:11px;">This is an automatic email from the ${APP_NAME} office app. Please do not reply to it.</p>
</div>
</body></html>`;
}

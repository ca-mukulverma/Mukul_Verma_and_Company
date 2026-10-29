import { APP_NAME, escapeHtml, staffEmail } from "./layout";

export function getPasswordSetupTemplate(name: string, setupUrl: string): string {
  return staffEmail({
    greetingName: name,
    paragraphs: [
      `Welcome to ${escapeHtml(APP_NAME)}, the firm's office app. An account has been created for you.`,
      "Please set your password using the button below to sign in.",
    ],
    button: { label: "Set your password", url: setupUrl },
    footnote: "The link is valid for 24 hours. If you were not expecting this email, you may ignore it.",
  });
}

export function getPasswordResetTemplate(name: string, resetUrl: string): string {
  return staffEmail({
    greetingName: name,
    paragraphs: [`We received a request to reset your ${escapeHtml(APP_NAME)} password. Please use the button below to choose a new one.`],
    button: { label: "Reset your password", url: resetUrl },
    footnote: "The link is valid for 24 hours. If you did not ask for this, you may ignore this email; your password stays the same.",
  });
}

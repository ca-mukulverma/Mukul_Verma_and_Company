// Pure helpers for the WhatsApp intake (no database, no Redis), so they can be
// tested on their own (tests/whatsapp). docs/WHATSAPP_INTAKE.md

export type WaKind = "REQUEST" | "QUERY" | "DOCUMENT" | "INFO" | "CHAT" | "STAFF";

const OFFICE_FROM = 11 * 60; // minutes after midnight IST
const OFFICE_TO = 20 * 60;
const IST_MS = 330 * 60 * 1000;

export const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

// ------------------------------------------------------------------ sorting messages (no AI)
const CHAT = /^(ok+|okay|k|thanks?|thank you|thx|ty|done|noted|received|got it|good (morning|evening|night)|gm|gn|hi|hello|sure|yes|no|haan|ha|ji|ji haan|theek( hai)?|thik( hai)?|accha|achha)[\s.!🙏👍]*$/i;
const ONLY_EMOJI = /^[\p{Extended_Pictographic}\s️‍]+$/u;
const REQUEST = /\b(please|pls|plz|kindly|send|bhej|bhejo|bhejna|chahiye|bana ?(do|dena|o)|banao|kar (do|dena|dijiye)|karwa|need|required|share|make|prepare|update|ledger|statement|bill|invoice|certificate|form ?16|return|challan|renew|quotation|quote|asap|urgent|jaldi)\b/i;
// with a file, only asking words make it a request ("Nov statement" is just the file)
const ACTION = /\b(please|pls|plz|kindly|send|bhej|bhejo|chahiye|bana ?(do|dena|o)|banao|kar (do|dena|dijiye)|karwa|need|make|prepare|urgent|asap|jaldi)\b|\?/i;
const QUERY = /\?|\b(kya|kab|kitna|kitne|kaise|kyun|kaun|what|when|how much|how many|status|due date|pending)\b/i;

export function classify(text: string | undefined, hasFile: boolean, isStaff: boolean): { kind: WaKind; status: string } {
  if (isStaff) return { kind: "STAFF", status: "CLOSED" };
  const t = (text ?? "").trim();
  if (hasFile) return ACTION.test(t) ? { kind: "REQUEST", status: "NEW" } : { kind: "DOCUMENT", status: "FILED" };
  if (!t || CHAT.test(t) || ONLY_EMOJI.test(t)) return { kind: "CHAT", status: "CLOSED" };
  if (REQUEST.test(t)) return { kind: "REQUEST", status: "NEW" };
  if (QUERY.test(t)) return { kind: "QUERY", status: "NEW" };
  return { kind: "INFO", status: "INFO" };
}

// ------------------------------------------------------------------ office hours (IST, Monday–Friday 11:00–20:00)

/** Minutes of office time between two moments. */
export function officeMinutes(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  const day = new Date(Math.floor((from.getTime() + IST_MS) / 86400000) * 86400000); // IST midnight (as UTC)
  for (let d = day.getTime(); d <= to.getTime() + IST_MS; d += 86400000) {
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const a = Math.max(d + OFFICE_FROM * 60000, from.getTime() + IST_MS);
    const b = Math.min(d + OFFICE_TO * 60000, to.getTime() + IST_MS);
    if (b > a) total += (b - a) / 60000;
  }
  return Math.round(total);
}


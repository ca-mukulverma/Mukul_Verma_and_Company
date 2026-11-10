// A client's logins by portal (Credential.kind): one section each on the
// client's Logins, plus any other login named by its title. Plain data and
// functions, used by the API and in the browser.

export const CREDENTIAL_KINDS = ["GST", "INCOME_TAX", "TDS_TRACES", "TDS_INCOME_TAX", "PF", "ESIC", "MCA", "OTHER"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

// The portals with a section of their own, in the order shown
export const PORTAL_KINDS = CREDENTIAL_KINDS.filter((k): k is Exclude<CredentialKind, "OTHER"> => k !== "OTHER");

export const KIND_INFO: Record<CredentialKind, { label: string; hint: string; username: string }> = {
  GST: { label: "GST", hint: "GST portal (services.gst.gov.in)", username: "GST username" },
  INCOME_TAX: { label: "Income tax", hint: "Income tax e-filing, the PAN login", username: "PAN / user ID" },
  TDS_TRACES: { label: "TDS – TRACES", hint: "TRACES, for Form 16 / 16A and TDS statements", username: "User ID" },
  TDS_INCOME_TAX: { label: "TDS – Income tax", hint: "Income tax e-filing, the TAN login", username: "TAN / user ID" },
  PF: { label: "PF", hint: "EPFO employer portal", username: "Establishment ID / user ID" },
  ESIC: { label: "ESIC", hint: "ESIC employer portal", username: "Employer code / user ID" },
  MCA: { label: "MCA", hint: "MCA portal (V3)", username: "User ID / email" },
  OTHER: { label: "Other", hint: "Any other login: name it", username: "Username / email" },
};

// The name a login shows: its portal, or an other login's own title
export const credentialName = (c: { kind: CredentialKind; title: string }) => (c.kind === "OTHER" ? c.title : KIND_INFO[c.kind].label);

// The portal of a login named only by a title (imports; logins saved before
// the sections, in the migration that added them): the GST portal login has
// "GST" but isn't the e-way bill / e-invoice one
export function guessKind(title: string): CredentialKind {
  const t = title.trim();
  if (/gst/i.test(t) && !/e[\s-]*way|\bewb\b|e[\s-]*invoice|\beinv|\birp\b/i.test(t)) return "GST";
  if (/traces/i.test(t)) return "TDS_TRACES";
  if (/\btds\b|\btan\b/i.test(t)) return "TDS_INCOME_TAX";
  if (/income|\bitr\b|e-?filing|\bit\b/i.test(t)) return "INCOME_TAX";
  if (/\bepfo?\b|\bpf\b|provident/i.test(t)) return "PF";
  if (/esic|\besi\b/i.test(t)) return "ESIC";
  if (/\bmca\b|\broc\b/i.test(t)) return "MCA";
  return "OTHER";
}

import { z } from "zod";
import { CREDENTIAL_KINDS, guessKind, KIND_INFO } from "@/lib/credential-kinds";

// A client's login as staff fill it in (Logins on the client's page and on
// Compliance → Clients): a portal, or "Other" named by its title. A portal's
// login is titled by the portal, so older readers of the title still work.
export const credentialInput = z
  .object({
    kind: z.enum(CREDENTIAL_KINDS).optional(),
    title: z.string().trim().max(75).optional().default(""),
    username: z.string().trim().max(75).optional().default(""),
    password: z.string().min(1, "Enter the password").max(100),
  })
  .transform((v, ctx) => {
    // Older callers send only a title
    const kind = v.kind ?? guessKind(v.title);
    const title = kind === "OTHER" ? v.title : KIND_INFO[kind].label;
    if (!title) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Name the login", path: ["title"] });
    return { kind, title, username: v.username, password: v.password };
  });

export const credentialSelect = {
  id: true,
  kind: true,
  title: true,
  username: true,
  password: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: { select: { name: true } },
} as const;

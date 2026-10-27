import { z } from "zod";

// A client's owner, the owner's mobile numbers and the person responsible for
// compliance (often the owner). Compliance reminders go to the responsible
// person only; the owner can be added when sending. There is no fallback: a
// responsible person without a WhatsApp number shows a warning instead.
// Used on the server and in the browser, so nothing here touches the database.

export interface ClientPhone {
  number: string;
  // e.g. Owner, Accountant, Office
  label: string;
  whatsapp: boolean;
}

export const PHONE_LABELS = ["Owner", "Accountant", "Office", "Other"];

export const phoneSchema = z.object({
  number: z.string().trim().min(6, "Enter the mobile number").max(15, "A number has at most 15 characters"),
  label: z.string().trim().min(1).max(20),
  whatsapp: z.boolean(),
});

export const contactsSchema = z.object({
  phones: z.array(phoneSchema).max(10).optional(),
  ownerIsResponsible: z.boolean().optional(),
  responsibleName: z.string().trim().max(50).optional().nullable(),
  responsiblePhone: z.string().trim().max(15).optional().nullable(),
  responsibleEmail: z.string().trim().email("Invalid email for the responsible person").max(75).optional().nullable().or(z.literal("")),
});

export type ContactsInput = z.infer<typeof contactsSchema>;

// The fields to save for the contacts part of a client form. `phone` is kept
// as the first number, which older screens and searches still use.
export function contactsData(input: ContactsInput) {
  const phones = input.phones?.filter((p) => p.number.trim());
  const responsible = input.ownerIsResponsible === false;
  return {
    ...(phones && { phones, phone: phones[0]?.number ?? null }),
    ...(input.ownerIsResponsible !== undefined && {
      ownerIsResponsible: !responsible,
      responsibleName: responsible ? input.responsibleName || null : null,
      responsiblePhone: responsible ? input.responsiblePhone || null : null,
      responsibleEmail: responsible ? input.responsibleEmail || null : null,
    }),
  };
}

// The checks a client form must pass besides the field formats
export function contactsError(input: ContactsInput): string | null {
  if (input.ownerIsResponsible === false && !input.responsibleName?.trim()) {
    return "Enter the responsible person's name, or tick that the owner is responsible";
  }
  return null;
}

export const clientContactSelect = {
  id: true,
  contactPerson: true,
  companyName: true,
  gstin: true,
  phone: true,
  phones: true,
  email: true,
  ownerIsResponsible: true,
  responsibleName: true,
  responsiblePhone: true,
  responsibleEmail: true,
} as const;

export interface ClientContactFields {
  contactPerson: string;
  phone: string | null;
  phones: unknown;
  email: string | null;
  ownerIsResponsible: boolean;
  responsibleName: string | null;
  responsiblePhone: string | null;
  responsibleEmail: string | null;
}

// The owner's numbers; clients saved before numbers had labels have `phone` only
export function clientPhones(client: Pick<ClientContactFields, "phone" | "phones">): ClientPhone[] {
  const parsed = z.array(phoneSchema).safeParse(client.phones);
  if (parsed.success && parsed.data.length) return parsed.data;
  return client.phone ? [{ number: client.phone, label: "Owner", whatsapp: true }] : [];
}

// Indian numbers for wa.me links: "098260 12345" → "919826012345"; null if unusable
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

// The owner's first WhatsApp number
export function ownerWhatsapp(client: Pick<ClientContactFields, "phone" | "phones">): string | null {
  for (const p of clientPhones(client)) {
    const number = p.whatsapp ? whatsappNumber(p.number) : null;
    if (number) return number;
  }
  return null;
}

export interface ReminderRecipient {
  role: "responsible" | "owner";
  name: string;
  whatsapp: string | null;
  email: string | null;
}

// Who compliance reminders go to: the responsible person, plus the owner when
// asked (and the owner is someone else)
export function reminderRecipients(client: ClientContactFields, alsoOwner = false): ReminderRecipient[] {
  const owner: ReminderRecipient = {
    role: "owner",
    name: client.contactPerson,
    whatsapp: ownerWhatsapp(client),
    email: client.email?.trim() || null,
  };
  if (client.ownerIsResponsible) return [{ ...owner, role: "responsible" }];
  const responsible: ReminderRecipient = {
    role: "responsible",
    name: client.responsibleName || "Responsible person",
    whatsapp: whatsappNumber(client.responsiblePhone),
    email: client.responsibleEmail?.trim() || null,
  };
  return alsoOwner ? [responsible, owner] : [responsible];
}

// What the compliance sheet shows about the client's contacts
export function reminderContacts(client: ClientContactFields) {
  const [responsible] = reminderRecipients(client);
  return {
    phone: client.phone,
    email: responsible.email,
    ownerIsResponsible: client.ownerIsResponsible,
    responsibleName: client.ownerIsResponsible ? null : responsible.name,
    // Shown as a warning on the sheet; reminders never fall back to the owner
    noWhatsapp: !responsible.whatsapp,
  };
}

// The clients a person picked last, shown at the top of client pickers.
// Kept in this browser only; nothing is sent to the server.

const KEY = "recent-clients";
const MAX = 5;

export interface RecentClient {
  id: string;
  contactPerson: string;
  companyName?: string | null;
}

export function getRecentClients(): RecentClient[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberClient(client: RecentClient) {
  try {
    const rest = getRecentClients().filter((c) => c.id !== client.id);
    const entry = { id: client.id, contactPerson: client.contactPerson, companyName: client.companyName ?? null };
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, MAX)));
  } catch {
    // Storage blocked: no recent list
  }
}

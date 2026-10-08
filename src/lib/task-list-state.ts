// Remembers where the user was in the task list (filters, page and scroll
// position) for this browser tab, so "back to tasks" returns there instead of
// the first page. sessionStorage can be unavailable (private mode), so every
// access is wrapped and falls back to the plain list.

export const TASK_LIST_PATH = "/dashboard/tasks";

const URL_KEY = "taskList:url";
const SCROLL_KEY = "taskList:scroll";

export function saveTaskListUrl(url: string) {
  try {
    sessionStorage.setItem(URL_KEY, url);
  } catch {
    // ignore
  }
}

// The last task list address (e.g. /dashboard/tasks?page=3&status=pending)
export function getTaskListUrl(): string {
  try {
    const url = sessionStorage.getItem(URL_KEY);
    if (url && (url === TASK_LIST_PATH || url.startsWith(`${TASK_LIST_PATH}?`))) {
      return url;
    }
  } catch {
    // ignore
  }
  return TASK_LIST_PATH;
}

// Called while the list is scrolled
export function saveTaskListScroll() {
  try {
    if (window.location.pathname !== TASK_LIST_PATH) return;
    sessionStorage.setItem(
      SCROLL_KEY,
      JSON.stringify({ url: window.location.pathname + window.location.search, y: window.scrollY })
    );
  } catch {
    // ignore
  }
}

// The saved scroll position, if it belongs to the current list address
export function getTaskListScroll(): number | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (!raw) return null;
    const { url, y } = JSON.parse(raw);
    return url === window.location.pathname + window.location.search && typeof y === "number"
      ? y
      : null;
  } catch {
    return null;
  }
}

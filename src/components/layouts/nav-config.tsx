import {
  Briefcase,
  CalendarCheck,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  ListTodo,
  Receipt,
  Settings,
  Users,
} from "lucide-react";

// The menu, shared by the sidebar, the phone menu, the bottom bar, the
// search box and the keyboard shortcuts, so they never disagree.

export const STAFF_ROLES = ["ADMIN", "PARTNER", "BUSINESS_CONSULTANT", "BUSINESS_EXECUTIVE"];
const MANAGERS = ["ADMIN", "PARTNER"];

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
  // "g" then this key opens the page
  shortcut?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function roleDashboardPath(role: string) {
  switch (role) {
    case "ADMIN":
      return "/dashboard/admin";
    case "PARTNER":
      return "/dashboard/partner";
    default:
      return "/dashboard/junior";
  }
}

export function navGroups(role: string): NavGroup[] {
  const groups: NavGroup[] = [
    {
      title: "My work",
      items: [
        { title: "Today", href: "/dashboard/my-work", icon: ListTodo, roles: STAFF_ROLES, shortcut: "m" },
        { title: "Tasks", href: "/dashboard/tasks", icon: ClipboardList, roles: STAFF_ROLES, shortcut: "t" },
        { title: "Compliance", href: "/dashboard/compliance", icon: CalendarCheck, roles: STAFF_ROLES, shortcut: "p" },
      ],
    },
    {
      title: "Clients",
      items: [{ title: "Clients", href: "/dashboard/clients", icon: Briefcase, roles: STAFF_ROLES, shortcut: "c" }],
    },
    {
      title: "Office",
      items: [
        { title: "Billing", href: "/dashboard/billing", icon: Receipt, roles: STAFF_ROLES, shortcut: "b" },
        { title: "Dashboard", href: roleDashboardPath(role), icon: LayoutDashboard, roles: STAFF_ROLES, shortcut: "d" },
      ],
    },
    {
      title: "Admin",
      items: [
        {
          title: "Users",
          href: role === "ADMIN" ? "/dashboard/admin/users" : "/dashboard/partner/users",
          icon: Users,
          roles: MANAGERS,
          shortcut: "u",
        },
      ],
    },
    {
      title: "Settings",
      items: [
        { title: "Settings", href: "/dashboard/settings", icon: Settings, roles: STAFF_ROLES, shortcut: "s" },
        { title: "Help", href: "/dashboard/help", icon: HelpCircle, roles: STAFF_ROLES, shortcut: "e" },
      ],
    },
  ];

  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(role)) }))
    .filter((group) => group.items.length > 0);
}

export function navItems(role: string) {
  return navGroups(role).flatMap((group) => group.items);
}

// The four pages on the phone's bottom bar (the fifth button opens the menu)
export const BOTTOM_BAR_HREFS = ["/dashboard/my-work", "/dashboard/tasks", "/dashboard/compliance", "/dashboard/clients"];

// The page a path belongs to: the longest menu link it starts with
export function activeHref(pathname: string | null, items: NavItem[]) {
  if (!pathname) return null;
  let best: string | null = null;
  for (const item of items) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) best = item.href;
    }
  }
  return best;
}

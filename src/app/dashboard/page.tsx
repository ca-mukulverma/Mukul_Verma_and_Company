import { redirect } from "next/navigation";

// /dashboard on its own (old links, notifications without a page): My work
export default function DashboardIndex() {
  redirect("/dashboard/my-work");
}

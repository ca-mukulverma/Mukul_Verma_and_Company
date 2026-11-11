"use client";

import React from "react";
import { TaskDetailView } from "@/components/tasks/task-detail-view";

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <TaskDetailView taskId={id} />;
}

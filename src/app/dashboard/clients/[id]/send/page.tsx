"use client";

import { use } from "react";
import { SendToClient } from "@/components/clients/send-to-client";

export default function SendToClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SendToClient clientId={id} />;
}

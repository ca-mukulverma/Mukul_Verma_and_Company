"use client";

import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditClient, canModifyClient } from "@/lib/permissions";
import { CredentialSections } from "./credential-sections";

// The client's page → Credentials: the client's logins by portal, the same
// sections as on Compliance → Clients
export function CredentialsTab({ clientId }: { clientId: string }) {
  const { data: session } = useSession();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Credentials</CardTitle>
        <CardDescription>The client&apos;s logins: GST, Income tax, TDS, PF, ESIC, MCA and any other portal</CardDescription>
      </CardHeader>
      <CardContent>
        <CredentialSections clientId={clientId} canEdit={canEditClient(session)} canDelete={canModifyClient(session)} />
      </CardContent>
    </Card>
  );
}

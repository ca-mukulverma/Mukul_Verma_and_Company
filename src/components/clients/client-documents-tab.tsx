"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { uploadComplianceFile } from "@/components/compliance/upload";
import { CLIENT_DOC_GROUPS, CLIENT_DOC_TYPES, clientDocType, fyLabel, fyOf } from "@/lib/client-documents";

// Client → Documents: the client's registrations (kept once) and yearly papers
// (ITRs, financials …), picked by Send to Client. Files of compliance periods
// stay on the compliance sheet.

interface ClientDocument {
  id: string;
  docType: string | null;
  financialYear: number | null;
  label: string;
  fileName: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
  canDelete: boolean;
}

const errorOf = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || (e instanceof Error ? e.message : fallback);

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ClientDocumentsTab({ clientId }: { clientId: string }) {
  const [documents, setDocuments] = useState<ClientDocument[] | null>(null);
  const [storageReady, setStorageReady] = useState(true);
  const lastFy = fyOf(new Date()) - 1;
  const [docType, setDocType] = useState("PAN_CARD");
  const [financialYear, setFinancialYear] = useState(lastFy);
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/clients/${clientId}/documents`);
      setDocuments(data.documents);
      setStorageReady(data.storageReady);
    } catch (e) {
      toast.error(errorOf(e, "Failed to load documents"));
      setDocuments([]);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const type = clientDocType(docType);
  const years = useMemo(() => Array.from({ length: 12 }, (_, i) => lastFy + 1 - i), [lastFy]);

  const upload = async () => {
    if (!files.length) return toast.error("Choose the file to upload");
    setUploading(true);
    try {
      for (const file of files) {
        await uploadComplianceFile(file, {
          clientId,
          kind: "OTHER",
          docType,
          financialYear: type?.yearly ? financialYear : null,
        });
      }
      toast.success(files.length > 1 ? `${files.length} files uploaded` : "File uploaded");
      setFiles([]);
      setInputKey((k) => k + 1);
      await load();
    } catch (e) {
      toast.error(errorOf(e, "The file could not be uploaded"));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (doc: ClientDocument) => {
    if (!window.confirm(`Remove ${doc.label} (${doc.fileName})?`)) return;
    setDeleting(doc.id);
    try {
      await axios.delete(`/api/compliance/documents/${doc.id}`);
      setDocuments((list) => list?.filter((d) => d.id !== doc.id) ?? null);
    } catch (e) {
      toast.error(errorOf(e, "The file could not be removed"));
    } finally {
      setDeleting(null);
    }
  };

  // By group, then type, latest year first
  const grouped = useMemo(() => {
    const groups = new Map<string, ClientDocument[]>();
    for (const doc of documents ?? []) {
      const group = clientDocType(doc.docType)?.group ?? "Other files";
      groups.set(group, [...(groups.get(group) ?? []), doc]);
    }
    const order = [...CLIENT_DOC_GROUPS, "Other files"];
    return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [documents]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add documents</CardTitle>
          <CardDescription>
            Registrations are kept once; ITRs, financials and other yearly papers per financial year. Send to Client picks them from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!storageReady && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Document storage (Cloudflare R2) is not set up yet, so files can&apos;t be uploaded. See docs/COMPLIANCE.md.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1">
              <Label>Document</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_DOC_GROUPS.map((group) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {CLIENT_DOC_TYPES.filter((t) => t.group === group).map((t) => (
                        <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type?.yearly && (
              <div className="space-y-1">
                <Label>Financial year</Label>
                <Select value={String(financialYear)} onValueChange={(v) => setFinancialYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={String(y)}>{fyLabel(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label>File (PDF, image, Excel, ZIP; up to 15 MB)</Label>
              <Input
                key={inputKey}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.zip,.json"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </div>
            <Button onClick={upload} disabled={uploading || !storageReady || files.length === 0}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents on record</CardTitle>
        </CardHeader>
        <CardContent>
          {documents === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : documents.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-10 w-10 opacity-20" />
              No documents yet
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([group, docs]) => (
                <div key={group} className="space-y-1">
                  <h4 className="text-sm font-medium text-muted-foreground">{group}</h4>
                  <ul className="divide-y rounded-md border">
                    {docs.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-2 p-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{doc.label}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {doc.fileName} · {formatSize(doc.size)} · {format(new Date(doc.createdAt), "d MMM yyyy")}
                            {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon" asChild aria-label="Download">
                          <a href={`/api/compliance/documents/${doc.id}`} target="_blank" rel="noreferrer">
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                        {doc.canDelete && (
                          <Button variant="ghost" size="icon" aria-label="Remove" disabled={deleting === doc.id} onClick={() => remove(doc)}>
                            {deleting === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { CREDENTIAL_KINDS, CredentialKind, credentialName, KIND_INFO, PORTAL_KINDS } from "@/lib/credential-kinds";

// A client's logins, a section per portal (GST, Income tax, TDS – TRACES,
// TDS – Income tax, PF, ESIC, MCA) and any other login named by its title.
// On the client's page (Credentials) and on Compliance → Clients, so a login
// can be filled in where the work is done. All staff add, change, see and
// copy logins (who changed one last is shown); only Admins delete them.

export interface Credential {
  id: string;
  kind: CredentialKind;
  title: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: { name: string } | null;
}

interface Props {
  clientId: string;
  canEdit: boolean;
  canDelete: boolean;
  // Called after a login is added, changed or deleted
  onChanged?: (credentials: Credential[]) => void;
}

const errorText = (e: unknown, fallback: string) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

export function CredentialSections({ clientId, canEdit, canDelete, onChanged }: Props) {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<{ credential: Credential | null; kind: CredentialKind } | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<{ credentials: Credential[] }>(`/api/clients/${clientId}/credentials`);
      setCredentials(data.credentials ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [clientId]);
  useEffect(() => {
    setCredentials(null);
    load();
  }, [load]);

  const changed = (next: Credential[]) => {
    setCredentials(next);
    onChanged?.(next);
  };

  const remove = async () => {
    if (!deleting || !credentials) return;
    setBusy(true);
    try {
      await axios.delete(`/api/clients/${clientId}/credentials/${deleting.id}`);
      changed(credentials.filter((c) => c.id !== deleting.id));
      toast.success(`${credentialName(deleting)} login deleted`);
      setDeleting(null);
    } catch (e) {
      toast.error(errorText(e, "Couldn't delete the login"));
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Couldn&apos;t load the logins.
        <Button size="sm" variant="outline" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }
  if (!credentials) return <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin" />;

  const others = credentials.filter((c) => c.kind === "OTHER");
  const row = (c: Credential) => (
    <LoginRow
      key={c.id}
      credential={c}
      shown={shown.has(c.id)}
      onToggle={() =>
        setShown((s) => {
          const next = new Set(s);
          if (next.has(c.id)) next.delete(c.id);
          else next.add(c.id);
          return next;
        })
      }
      onEdit={canEdit ? () => setEditing({ credential: c, kind: c.kind }) : undefined}
      onDelete={canDelete ? () => setDeleting(c) : undefined}
    />
  );

  return (
    <div className="space-y-2 text-sm">
      <ul className="divide-y rounded-md border">
        {PORTAL_KINDS.map((kind) => {
          const saved = credentials.filter((c) => c.kind === kind);
          return (
            <li key={kind} className="flex flex-col gap-1 p-2 sm:flex-row sm:items-start">
              <div className="w-44 shrink-0">
                <p className="font-medium">{KIND_INFO[kind].label}</p>
                <p className="text-[11px] text-muted-foreground">{KIND_INFO[kind].hint}</p>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {saved.length ? saved.map(row) : <p className="py-1 text-muted-foreground">Not saved</p>}
              </div>
              {canEdit && !saved.length && (
                <Button size="sm" variant="outline" className="h-7 self-start" onClick={() => setEditing({ credential: null, kind })}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              )}
            </li>
          );
        })}
        <li className="flex flex-col gap-1 p-2 sm:flex-row sm:items-start">
          <div className="w-44 shrink-0">
            <p className="font-medium">Other logins</p>
            <p className="text-[11px] text-muted-foreground">Any other portal, named by you</p>
          </div>
          <div className="min-w-0 flex-1 space-y-1">{others.length ? others.map(row) : <p className="py-1 text-muted-foreground">None</p>}</div>
          {canEdit && (
            <Button size="sm" variant="outline" className="h-7 self-start" onClick={() => setEditing({ credential: null, kind: "OTHER" })}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add other
            </Button>
          )}
        </li>
      </ul>

      {editing && (
        <LoginDialog
          clientId={clientId}
          credential={editing.credential}
          kind={editing.kind}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            changed(editing.credential ? credentials.map((c) => (c.id === saved.id ? saved : c)) : [...credentials, saved]);
            setEditing(null);
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the {deleting ? credentialName(deleting) : ""} login?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone: the username and password are removed from the app.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy} onClick={remove}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LoginRow({ credential: c, shown, onToggle, onEdit, onDelete }: { credential: Credential; shown: boolean; onToggle: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Couldn't copy")
    );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {c.kind === "OTHER" && <span className="font-medium">{c.title}</span>}
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate" title={c.username}>
          {c.username || <span className="text-muted-foreground">no username</span>}
        </span>
        {c.username && (
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(c.username, "Username")} aria-label="Copy username">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
      <span className="flex items-center gap-1">
        <span className={cn("rounded bg-muted px-2 py-0.5 font-mono text-xs", !shown && "tracking-widest")}>{shown ? c.password : "•".repeat(Math.min(10, c.password.length))}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"}>
          {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(c.password, "Password")} aria-label="Copy password">
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </span>
      {c.updatedBy && (
        <span className="text-[11px] text-muted-foreground" title={`Last changed ${new Date(c.updatedAt).toLocaleString("en-IN")}`}>
          by {c.updatedBy.name}, {new Date(c.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      )}
      {(onEdit || onDelete) && (
        <span className="ml-auto flex items-center gap-1">
          {onEdit && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} aria-label="Change login">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete} aria-label="Delete login">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      )}
    </div>
  );
}

function LoginDialog({
  clientId,
  credential,
  kind: initialKind,
  onClose,
  onSaved,
}: {
  clientId: string;
  credential: Credential | null;
  kind: CredentialKind;
  onClose: () => void;
  onSaved: (c: Credential) => void;
}) {
  const [kind, setKind] = useState<CredentialKind>(initialKind);
  const [title, setTitle] = useState(credential?.kind === "OTHER" ? credential.title : "");
  const [username, setUsername] = useState(credential?.username ?? "");
  const [password, setPassword] = useState(credential?.password ?? "");
  const [show, setShow] = useState(!credential);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (kind === "OTHER" && !title.trim()) return toast.error("Name the login");
    if (!password) return toast.error("Enter the password");
    setSaving(true);
    try {
      const body = { kind, title: kind === "OTHER" ? title.trim() : "", username: username.trim(), password };
      const { data } = credential
        ? await axios.patch<Credential>(`/api/clients/${clientId}/credentials/${credential.id}`, body)
        : await axios.post<Credential>(`/api/clients/${clientId}/credentials`, body);
      toast.success(`${credentialName(data)} login ${credential ? "saved" : "added"}`);
      onSaved(data);
    } catch (e) {
      toast.error(errorText(e, "Couldn't save the login"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {credential ? "Change login" : "Add login"}
          </DialogTitle>
          <DialogDescription>{KIND_INFO[kind].hint}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label>Portal</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CredentialKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDENTIAL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k === "OTHER" ? "Other (name it)" : KIND_INFO[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === "OTHER" && (
            <div className="space-y-1.5">
              <Label htmlFor="login-title">Name *</Label>
              <Input id="login-title" maxLength={75} placeholder="e.g. Professional tax, Shop licence, E-way bill" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="login-username">{KIND_INFO[kind].username}</Label>
            <Input id="login-username" maxLength={75} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={kind !== "OTHER"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login-password">Password *</Label>
            <div className="flex gap-1">
              <Input
                id="login-password"
                type={show ? "text" : "password"}
                maxLength={100}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="button" size="icon" variant="outline" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {credential ? "Save" : "Add login"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

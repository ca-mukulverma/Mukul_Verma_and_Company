"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Download, KeyRound, Loader2, MonitorCheck, MonitorX, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpLink } from "@/components/help/help-link";
import { useActivePolling } from "@/hooks/use-active-polling";
import { cn } from "@/lib/utils";
import {
  FORMAT_LABELS,
  GST_PORTAL_FORMATS,
  GST_PORTAL_RETURNS,
  GstPortalFormat,
  GstPortalJobStatus,
  GstPortalReturn,
  HELPER_SEEN_MINUTES,
  JobLogLine,
  portalMonthLabel,
  RETURN_LABELS,
  STATUS_LABELS,
  UNFINISHED_STATUSES,
} from "@/lib/gst-portal";
import { apiError, currentMonthKey } from "./types";

// Compliance → Clients → the client → GST portal, next to the GST working:
// staff queue the client's downloads; the helper program on the office PC
// opens the GST portal, staff type the captcha and OTP there, and the returns
// are saved into the client's periods. See docs/GST_PORTAL_DOWNLOADS.md.

interface Job {
  id: string;
  clientId: string;
  months: string[];
  returns: GstPortalReturn[];
  formats: GstPortalFormat[];
  status: GstPortalJobStatus;
  progress: string | null;
  log: JobLogLine[] | null;
  filesSaved: number;
  error: string | null;
  helperName: string | null;
  requestedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface PendingJson {
  id: string;
  clientId: string;
  returnType: GstPortalReturn;
  month: string;
  requestedAt: string;
}

interface PortalData {
  jobs: Job[];
  pendingJson: PendingJson[];
  helperSeen: { at: string; name: string } | null;
  client: { gstin: string | null; hasLogin: boolean };
  othersWaiting: string[];
}

// Refresh while a job is queued or running (and someone is using the app)
const POLL_MS = 15_000;

const STATUS_STYLES: Record<GstPortalJobStatus, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  CLAIMED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  WAITING_LOGIN: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  DONE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  PARTLY_DONE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  CANCELLED: "bg-muted text-muted-foreground",
};

const isUnfinished = (status: GstPortalJobStatus) => (UNFINISHED_STATUSES as readonly string[]).includes(status);

// April-to-March year of a month key ("2026-02" → 2025)
function fyOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;

function fyMonths(fy: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${m >= 4 ? fy : fy + 1}-${String(m).padStart(2, "0")}`;
  });
}

const timeText = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

function minutesSince(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

function monthsText(months: string[]) {
  if (months.length <= 3) return months.map(portalMonthLabel).join(", ");
  return `${portalMonthLabel(months[0])} – ${portalMonthLabel(months[months.length - 1])} (${months.length} months)`;
}

export function ClientGstPortal({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [data, setData] = useState<PortalData | null>(null);
  // Files saved so far by this client's jobs: a change refreshes the working
  const saved = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<PortalData>("/api/compliance/gst-portal", { params: { clientId } });
      setData(data);
    } catch (error) {
      toast.error(apiError(error, "Could not load GST portal downloads"));
    }
  }, [clientId]);

  useEffect(() => {
    setData(null);
    saved.current = null;
    load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const total = data.jobs.reduce((sum, j) => sum + j.filesSaved, 0);
    if (saved.current !== null && total !== saved.current) onSaved();
    saved.current = total;
  }, [data, onSaved]);

  const active = !!data?.jobs.some((j) => isUnfinished(j.status));
  useActivePolling(load, POLL_MS, active);

  if (!data) return <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin" />;
  if (!data.client.gstin?.trim()) {
    return <p className="text-sm text-muted-foreground">Save this client&apos;s GSTIN to download its returns from the GST portal.</p>;
  }

  const waiting = data.jobs.some((j) => j.status === "WAITING_LOGIN");

  return (
    <div className="space-y-3">
      <HelperStatus seen={data.helperSeen} />
      {waiting && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-semibold">Go to the helper PC: type the captcha and OTP for this client.</p>
        </div>
      )}
      {data.othersWaiting.length > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300">Also waiting for the captcha at the helper PC: {data.othersWaiting.join(", ")}.</p>
      )}
      {!data.client.hasLogin && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No GST login saved (Clients → Credentials, with “GST” in the title): staff type the username and password at the helper PC too.
        </p>
      )}
      <QueueForm clientId={clientId} busy={active} onQueued={load} />
      <JobList jobs={data.jobs} onChanged={load} />
      <PendingJsonList requests={data.pendingJson} />
    </div>
  );
}

function HelperStatus({ seen }: { seen: PortalData["helperSeen"] }) {
  const minutes = seen ? minutesSince(seen.at) : null;
  const ok = minutes !== null && minutes <= HELPER_SEEN_MINUTES;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border p-2 text-sm",
        ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      {ok ? <MonitorCheck className="h-4 w-4 shrink-0" /> : <MonitorX className="h-4 w-4 shrink-0" />}
      {!seen ? (
        <span>The helper on the office PC has not been seen yet. Start it there (see the setup in the help).</span>
      ) : ok ? (
        <span>
          Helper <span className="font-medium">{seen.name}</span> is running (last seen {minutes! < 1 ? "just now" : `${minutes} min ago`}).
        </span>
      ) : (
        <span>
          Helper <span className="font-medium">{seen.name}</span> last seen {timeText(seen.at)}. Queued jobs wait until it runs (it sleeps outside office
          hours).
        </span>
      )}
    </div>
  );
}

function QueueForm({ clientId, busy, onQueued }: { clientId: string; busy: boolean; onQueued: () => void }) {
  const thisMonth = currentMonthKey();
  const currentFy = fyOf(thisMonth);
  const [fy, setFy] = useState(currentFy);
  const [months, setMonths] = useState<string[]>([]);
  const [returns, setReturns] = useState<GstPortalReturn[]>([...GST_PORTAL_RETURNS]);
  const [formats, setFormats] = useState<GstPortalFormat[]>(["PDF", "JSON"]);
  const [saving, setSaving] = useState(false);

  // Months that are over or running; the portal has nothing for later ones
  const yearMonths = fyMonths(fy);
  const open = yearMonths.filter((m) => m <= thisMonth);
  const allTicked = open.length > 0 && open.every((m) => months.includes(m));

  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));

  const submit = async () => {
    if (!months.length) return toast.error("Choose at least one month");
    if (!returns.length) return toast.error("Choose at least one return");
    if (!formats.length) return toast.error("Choose at least one file type");
    setSaving(true);
    try {
      await axios.post("/api/compliance/gst-portal", {
        clientIds: [clientId],
        months,
        returns,
        formats,
      });
      toast.success("Download queued. Keep the helper PC ready for the captcha and OTP.");
      setMonths([]);
      onQueued();
    } catch (error) {
      toast.error(apiError(error, "Could not queue the download"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="flex items-center gap-1 text-sm font-medium">
          Download from the GST portal
          <HelpLink section="gst-portal" />
        </p>
        <p className="text-xs text-muted-foreground">
          The helper on the office PC opens the portal and fills in the saved login. Someone types the captcha and OTP there; the files are then saved into this
          client&apos;s periods and the GST working, as if uploaded by you.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">Months of</p>
          <Select
            value={String(fy)}
            onValueChange={(v) => {
              setFy(Number(v));
              setMonths([]);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3].map((back) => (
                <SelectItem key={back} value={String(currentFy - back)}>
                  FY {fyLabel(currentFy - back)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allTicked} onCheckedChange={(on) => setMonths(on === true ? open : [])} /> All months
          </label>
        </div>
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
          {yearMonths.map((m) => (
            <label key={m} className={cn("flex items-center gap-2 text-sm", m > thisMonth && "opacity-50")}>
              <Checkbox
                disabled={m > thisMonth}
                checked={months.includes(m)}
                onCheckedChange={(on) => setMonths((list) => toggle(list, m, on === true).sort())}
              />
              {portalMonthLabel(m)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Returns</p>
          <div className="flex flex-wrap gap-4">
            {GST_PORTAL_RETURNS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <Checkbox checked={returns.includes(r)} onCheckedChange={(on) => setReturns((list) => toggle(list, r, on === true))} />
                {RETURN_LABELS[r]}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Files</p>
          <div className="flex flex-wrap gap-4">
            {GST_PORTAL_FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <Checkbox checked={formats.includes(f)} onCheckedChange={(on) => setFormats((list) => toggle(list, f, on === true))} />
                {f === "EXCEL" ? "Excel (GSTR-2B)" : FORMAT_LABELS[f]}
              </label>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        GSTR-1 JSON takes the portal about 20 minutes to prepare. The helper asks for it first, downloads the PDFs meanwhile and collects the JSON at the end;
        anything still not ready is collected by the client&apos;s next download.
      </p>

      <Button size="sm" onClick={submit} disabled={saving || busy} title={busy ? "A download is already queued or running for this client" : undefined}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        {busy ? "Download queued or running" : "Queue download"}
      </Button>
    </div>
  );
}

function JobList({ jobs, onChanged }: { jobs: Job[]; onChanged: () => void }) {
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const act = async (job: Job, action: "cancel" | "retry") => {
    setWorking(job.id);
    try {
      await axios.patch(`/api/compliance/gst-portal/${job.id}`, { action });
      toast.success(action === "cancel" ? "Download cancelled" : "Download queued again");
      onChanged();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Downloads</p>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing downloaded for this client yet.</p>
      ) : (
        <ul className="divide-y">
          {jobs.map((job) => (
            <li key={job.id} className="space-y-1 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[job.status])}>{STATUS_LABELS[job.status]}</span>
                <span className="text-muted-foreground">
                  {job.returns.map((r) => RETURN_LABELS[r]).join(", ")} · {job.formats.map((f) => FORMAT_LABELS[f]).join(", ")} · {monthsText(job.months)}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {job.filesSaved} file{job.filesSaved === 1 ? "" : "s"} saved
                  </span>
                  {isUnfinished(job.status) ? (
                    <Button variant="ghost" size="sm" disabled={working === job.id} onClick={() => act(job, "cancel")}>
                      <X className="mr-1 h-3.5 w-3.5" /> Cancel
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" disabled={working === job.id} onClick={() => act(job, "retry")}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Run again
                    </Button>
                  )}
                </span>
              </div>
              {job.error ? (
                <p className="flex items-start gap-1 text-red-700 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {job.error}
                </p>
              ) : (
                job.progress && <p className="text-muted-foreground">{job.progress}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Queued {timeText(job.createdAt)}
                  {job.requestedBy && ` by ${job.requestedBy}`}
                  {job.finishedAt && ` · finished ${timeText(job.finishedAt)}`}
                </span>
                {job.log && job.log.length > 0 && (
                  <button className="flex items-center hover:underline" onClick={() => setOpenLog(openLog === job.id ? null : job.id)}>
                    {openLog === job.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Log
                  </button>
                )}
              </div>
              {openLog === job.id && job.log && (
                <ul className="max-h-64 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs">
                  {job.log.map((line, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">
                        {new Date(line.at).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>{" "}
                      {line.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingJsonList({ requests }: { requests: PendingJson[] }) {
  if (!requests.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">GSTR-1 JSON waiting to be collected</p>
      <p className="text-xs text-muted-foreground">
        Asked for on the portal but not downloaded yet. The client&apos;s next download collects them without asking again.
      </p>
      <ul className="divide-y text-sm">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap gap-2 py-1.5">
            <span>
              {RETURN_LABELS[r.returnType]} {portalMonthLabel(r.month)}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">asked {timeText(r.requestedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

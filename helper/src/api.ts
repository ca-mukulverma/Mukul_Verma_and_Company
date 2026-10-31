import type { GstRead } from "../../src/lib/gst-read/index";

// A typed client for the office app's /api/gst-helper routes
// (src/app/api/gst-helper in the app).

export type ReturnType = "GSTR1" | "GSTR3B" | "GSTR2B";
export type FileFormat = "PDF" | "JSON" | "EXCEL";

export interface PendingJson {
  id: string;
  returnType: ReturnType;
  month: string;
  requestedAt: string;
}

export interface ClaimedJob {
  id: string;
  months: string[];
  returns: ReturnType[];
  formats: FileFormat[];
  client: { id: string; name: string; gstin: string | null };
  // null: no GST login saved; staff type the username and password too
  login: { username: string; password: string } | null;
  pendingJson: PendingJson[];
}

export interface FileDescription {
  returnType: ReturnType;
  month: string;
  format: FileFormat;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  gzipped: boolean;
  gst?: GstRead | null;
}

export interface JsonRequest {
  id: string;
  returnType: ReturnType;
  month: string;
  requestedAt: string;
  status: string;
  parts?: number | null;
}

// Staff cancelled the job in the app: stop quietly
export class CancelledError extends Error {
  constructor() {
    super("Cancelled by staff");
    this.name = "CancelledError";
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const RETRIES = 3;

export class OfficeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/gst-helper/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-GST-Helper-Key": this.key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        // Network trouble: try again
        lastError = error;
        continue;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; cancelled?: boolean };
      if (response.status === 409 && data.cancelled) throw new CancelledError();
      if (response.ok) return data as T;
      lastError = new ApiError(data.error || `The office app answered ${response.status}`, response.status);
      // The app or Vercel is having a moment: try again; anything else is final
      if (response.status < 500) throw lastError;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  claim(helperName: string) {
    return this.post<{ job: ClaimedJob | null }>("claim", { helperName });
  }

  status(jobId: string, body: { status?: "WAITING_LOGIN" | "RUNNING"; progress?: string; log?: string[] }) {
    return this.post<{ ok: true }>(`jobs/${jobId}/status`, body);
  }

  uploadUrl(jobId: string, file: FileDescription) {
    return this.post<{ key: string; alreadyStored: boolean; url?: string }>(`jobs/${jobId}/upload-url`, file);
  }

  document(jobId: string, file: FileDescription) {
    return this.post<{ created: boolean; filed: string | null; itemId: string | null }>(`jobs/${jobId}/document`, file);
  }

  createJsonRequest(jobId: string, returnType: ReturnType, month: string) {
    return this.post<{ request: JsonRequest }>(`jobs/${jobId}/json-requests`, { action: "create", returnType, month });
  }

  updateJsonRequest(jobId: string, requestId: string, status: "REQUESTED" | "DOWNLOADED" | "EXPIRED" | "FAILED", parts?: number | null) {
    return this.post<{ request: JsonRequest }>(`jobs/${jobId}/json-requests`, { action: "update", requestId, status, parts });
  }

  finish(jobId: string, body: { status: "DONE" | "PARTLY_DONE" | "FAILED"; error?: string | null; log?: string[] }) {
    return this.post<{ ok: true }>(`jobs/${jobId}/finish`, body);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EVERY GST-PORTAL-SPECIFIC DETAIL IS IN THIS ONE FILE.
//
//  Written from the portal's usual layout, NOT TESTED AGAINST A LIVE LOGIN.
//  Check each entry before first real use, and again whenever the portal
//  changes:
//
//    npm run inspect   opens the login page with the Playwright Inspector:
//                      log in by hand, then use "Pick locator" on each
//                      button, link and drop-down named below
//    npm run record    records your clicks as code (Playwright codegen)
//
//  Prefer case-insensitive text (what staff see on screen) over CSS ids:
//  the portal's ids and classes change more often than its wording.
//  Also check against a real login: how long GSTR-1 JSON takes to be ready
//  (JSON_READY_MINUTES), how long its download links stay, and how soon the
//  portal logs out an idle session.
// ═══════════════════════════════════════════════════════════════════════════

// Something to click: text shown on a button or link (matched
// case-insensitively), or a CSS selector as a last resort
export type Target = { text: RegExp; role?: "button" | "link" } | { css: string };

// One step of a recipe. "download" is the click that produces the file:
// a browser download, or a PDF / ZIP / Excel shown in the tab or a new tab.
export type Step = { click: Target } | { download: Target };

export interface Recipe {
  // The text in the return's box on the Returns Dashboard
  tile: RegExp;
  steps: Step[];
}

export const URLS = {
  login: "https://services.gst.gov.in/services/login",
  // After the captcha (and OTP, where asked) the address has /services/auth/
  loggedIn: /services\.gst\.gov\.in\/services\/auth\//i,
  returnsDashboard: "https://return.gst.gov.in/returns/auth/dashboard",
  logout: "https://services.gst.gov.in/services/logout",
  // Opened by keepAlive between JSON checks so the session doesn't go idle
  keepAlive: "https://services.gst.gov.in/services/auth/fowelcome",
};

export const LOGIN = {
  username: "#username",
  password: "#user_pass",
  captcha: "#captcha",
};

// The Returns Dashboard's drop-downs, found by their label (or the CSS as a
// fallback), and the options picked by their text
export const DASHBOARD = {
  financialYear: { label: /financial\s*year/i, css: 'select[name="fin"]' },
  quarter: { label: /quarter/i, css: 'select[name="quarter"]' },
  period: { label: /period/i, css: 'select[name="mon"]' },
  search: { text: /^\s*search\s*$/i, role: "button" } as Target,
  // "2025-26"
  financialYearOption: (fy: number) => new RegExp(`^\\s*${fy}\\s*-\\s*${String((fy + 1) % 100).padStart(2, "0")}\\s*$`),
  // "Quarter 1 (Apr - Jun)"
  quarterOption: (q: 1 | 2 | 3 | 4) => new RegExp(`quarter\\s*${q}\\b`, "i"),
  // "April"
  periodOption: (monthName: string) => new RegExp(`^\\s*${monthName}\\s*$`, "i"),
};

// What the portal shows when there is nothing to download for the period,
// e.g. the middle month of a quarterly filer, or a return not filed yet
export const NOT_AVAILABLE = [
  /not\s+(yet\s+)?(been\s+)?filed/i,
  /no\s+record(s)?\s+found/i,
  /no\s+data\s+(is\s+)?available/i,
  /not\s+(applicable|available)\s+for\s+(this|the\s+selected)/i,
  /return\s+is\s+not\s+(yet\s+)?generated/i,
  /gstr-?2b\s+is\s+not\s+(yet\s+)?generated/i,
];

// The session has ended; the helper stops instead of clicking on
export const SESSION_EXPIRED = [/session\s+(has\s+)?expired/i, /session\s*time\s*-?\s*out/i, /please\s+log\s*in\s+again/i];

// How each file is downloaded, starting from the period's Returns Dashboard
export const RECIPES = {
  GSTR1: {
    tile: /GSTR-?1\b|\bIFF\b/i,
    PDF: [
      { click: { text: /^\s*view\s*$/i, role: "button" } },
      { download: { text: /download\s*\(?\s*pdf\s*\)?/i } },
    ],
    // GSTR-1 JSON is asked for and collected later (GSTR1_JSON below)
    JSON: null,
    EXCEL: null,
  },
  GSTR3B: {
    tile: /GSTR-?3B/i,
    PDF: [{ download: { text: /^\s*download\s*$/i, role: "button" } }],
    JSON: null,
    EXCEL: null,
  },
  GSTR2B: {
    tile: /GSTR-?2B/i,
    PDF: [
      { click: { text: /^\s*view\s*$/i, role: "button" } },
      { download: { text: /download\s+gstr-?2b\s+summary.*pdf|download\s*\(?\s*pdf\s*\)?/i } },
    ],
    JSON: [
      { click: { text: /^\s*download\s*$/i, role: "button" } },
      { download: { text: /generate\s+json\s+file\s+to\s+download/i } },
    ],
    EXCEL: [
      { click: { text: /^\s*download\s*$/i, role: "button" } },
      { download: { text: /generate\s+excel\s+file\s+to\s+download/i } },
    ],
  },
} satisfies Record<"GSTR1" | "GSTR3B" | "GSTR2B", Record<"PDF" | "JSON" | "EXCEL", Step[] | null> & { tile: RegExp }>;

// GSTR-1 JSON: asked for once, ready about 20 minutes later
export const GSTR1_JSON = {
  // From the period's dashboard, the GSTR-1 box's DOWNLOAD button
  open: { text: /^\s*download\s*$/i, role: "button" } as Target,
  generate: { text: /generate\s+json\s+file\s+to\s+download/i } as Target,
  // "Click here to download - File 1", "… - File 2"
  fileLink: /click\s+here\s+to\s+download\s*[-–]?\s*file\s*(\d+)/i,
  // Shown after Generate, and while the file is being prepared
  pending: [/request\s+for\s+generation\s+of\s+json.*(accepted|under\s+process|in\s+progress)/i, /kindly\s+wait/i, /being\s+(generated|prepared)/i],
};

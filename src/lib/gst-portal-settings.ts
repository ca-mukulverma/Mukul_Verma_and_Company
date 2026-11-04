// GST portal settings (docs/GST_PORTAL_EXTENSION_PLAN.md §7): everything the
// browser extension needs to know about the portal is data sent by the app
// with each run, never code in the extension, so a portal change is fixed by
// a deploy instead of reinstalling the extension on every PC. Built in for
// now; stage 6 keeps versions in the database.
//
// Version 1 is taught from the admin's recordings on the real portal (Nov
// 2026: GSTR-1 PDF and JSON, GSTR-3B PDF and GSTR-2B JSON for Sep 2026, and
// GSTR-3B of an unfiled month), plus the portal's own page templates seen in
// those recordings. Buttons are found by the text staff see, inside the
// return's own box on the Returns Dashboard, never by their position: the
// box of a return that isn't filed has "Prepare Online" / "Prepare Offline"
// (or "FILE GSTR3B" once submitted) where a filed one has "View" /
// "Download", so a click by position would press a filing button.

import type { PortalFile } from "@/lib/gst-read/working";

// Something on a portal page: visible text (a regular expression's source,
// matched case-insensitively against the whole label) or CSS
export interface PortalTarget {
  text?: string;
  css?: string;
}

// One step after the return's box has been found and checked:
//   click     click the target; with `url`, wait for the tab to reach it
//   file      click the target and catch the file the page makes
//   generate  click the target once (GSTR-1 JSON's Generate button): the
//             portal answers with the download links of a JSON it has
//             prepared already (fetched, every part), or starts preparing
//             one (collected on a later run). Never clicked twice in a visit:
//             a second click asks the portal to make a new file.
export interface PortalStep {
  kind: "click" | "file" | "generate";
  target: PortalTarget;
  // Inside the return's box on the dashboard, or anywhere on the page
  scope: "tile" | "page";
  url?: string;
  // generate: the links the portal shows once the file is ready
  links?: PortalTarget;
}

export interface PortalRecipe {
  tile: "GSTR1" | "GSTR3B" | "GSTR2B";
  // The box must show "Status - Filed" (GSTR-1, GSTR-3B; GSTR-2B has no status)
  filed: boolean;
  steps: PortalStep[];
}

export interface PortalSettings {
  version: number;
  urls: {
    login: string;
    // Regular expression (source) the address matches once logged in
    loggedIn: string;
    logout: string;
    dashboard: string;
  };
  login: { username: PortalTarget; password: PortalTarget; captcha: PortalTarget };
  // Close the portal tab if nobody completes the login in this time
  loginWaitMinutes: number;
  // A download run that has had nothing to do for this long logs out on its
  // own (the app tab was closed, the computer slept…)
  idleLogoutMinutes: number;
  dashboard: {
    // In this order; {fy} "2026-27", {quarter} 1–4, {month} "September"
    selects: { label: string; css: string; option: string; optional?: boolean }[];
    search: PortalTarget;
  };
  // The name shown in each return's box ("GSTR-3B" under "Monthly Return")
  tiles: Record<PortalRecipe["tile"], string>;
  // A filed return's box: "Status- Filed"
  filedStatus: string;
  files: Partial<Record<PortalFile, PortalRecipe>>;
  texts: {
    // Pop-ups closed whenever they show ("Remind me later" on the Aadhaar
    // pop-up comes once a session, so it is never a step of its own)
    dismiss: string[];
    // Never clicked, whatever a step says (the extension has its own list too)
    neverClick: string[];
    notAvailable: string[];
    sessionExpired: string[];
    jsonPending: string[];
  };
}

const anyLabel = (s: string) => `^\\s*${s}\\s*$`;

export const BUILT_IN_SETTINGS: PortalSettings = {
  version: 1,
  urls: {
    login: "https://services.gst.gov.in/services/login",
    // After the captcha (and OTP, where asked) the address has /services/auth/
    loggedIn: "^https://services\\.gst\\.gov\\.in/services/auth/",
    logout: "https://services.gst.gov.in/services/logout",
    dashboard: "https://return.gst.gov.in/returns/auth/dashboard",
  },
  login: {
    username: { css: "#username" },
    password: { css: "#user_pass" },
    captcha: { css: "#captcha" },
  },
  loginWaitMinutes: 10,
  idleLogoutMinutes: 5,
  dashboard: {
    selects: [
      { label: "financial\\s*year", css: 'select[name="fin"]', option: anyLabel("{fy}") },
      // Only for some taxpayers and years
      { label: "quarter", css: 'select[name="quarter"]', option: "quarter\\s*{quarter}\\b", optional: true },
      { label: "period", css: 'select[name="mon"]', option: anyLabel("{month}") },
    ],
    search: { text: anyLabel("search") },
  },
  tiles: {
    GSTR1: "^\\s*(GSTR-?1|Invoice Furnishing Facility)\\s*$",
    GSTR3B: "^\\s*GSTR-?3BQ?\\s*$",
    GSTR2B: "^\\s*GSTR-?2BQ?\\s*$",
  },
  filedStatus: "status\\s*-?\\s*filed\\b(?!\\s*-\\s*invalid)",
  files: {
    // Box: DOWNLOAD (a pdf made in the page)
    GSTR3B_PDF: {
      tile: "GSTR3B",
      filed: true,
      steps: [{ kind: "file", scope: "tile", target: { text: anyLabel("download") } }],
    },
    // Box: VIEW → VIEW SUMMARY → DOWNLOAD (PDF). A return not filed shows
    // "DOWNLOAD SUMMARY (PDF)" there instead, which is not matched.
    GSTR1_PDF: {
      tile: "GSTR1",
      filed: true,
      steps: [
        { kind: "click", scope: "tile", target: { text: anyLabel("view") }, url: "^https://return\\.gst\\.gov\\.in/returns/auth/gstr1\\b" },
        { kind: "click", scope: "page", target: { text: anyLabel("view summary") } },
        { kind: "file", scope: "page", target: { text: anyLabel("download\\s*\\(pdf\\)") } },
      ],
    },
    // Box: DOWNLOAD → GENERATE JSON FILE TO DOWNLOAD. The portal's page
    // (main.js, offline download) asks /offline/download/generate on each
    // click: with a JSON prepared already it answers with the links "Click
    // here to download - File 1…" (to /returns/auth/api/offline/download/url),
    // otherwise it starts preparing one (about 20 minutes)
    GSTR1_JSON: {
      tile: "GSTR1",
      filed: true,
      steps: [
        { kind: "click", scope: "tile", target: { text: anyLabel("download") } },
        {
          kind: "generate",
          scope: "page",
          target: { text: anyLabel("generate\\s*json\\s*file\\s*to\\s*download") },
          links: { text: "click\\s*here\\s*to\\s*download\\s*-?\\s*file\\s*\\d+" },
        },
      ],
    },
    // Box: DOWNLOAD → GENERATE JSON FILE TO DOWNLOAD on gstr2b.gst.gov.in
    GSTR2B_JSON: {
      tile: "GSTR2B",
      filed: false,
      steps: [
        { kind: "click", scope: "tile", target: { text: anyLabel("download") }, url: "^https://gstr2b\\.gst\\.gov\\.in/gstr2b/auth/" },
        { kind: "file", scope: "page", target: { text: anyLabel("generate\\s*json\\s*file\\s*to\\s*download") } },
      ],
    },
  },
  texts: {
    dismiss: [anyLabel("remind\\s*me\\s*later")],
    neverClick: [
      "^\\s*file\\b",
      "\\bfile\\s*(return|statement|gstr|with|iff)",
      "\\bsubmit\\b",
      "prepare\\s*(online|offline)",
      "\\breset\\b",
      "proceed",
      "\\bsign\\b",
      "\\bevc\\b",
      "\\bdsc\\b",
      "delete",
      "payment",
      "offset",
      "\\bupload\\b",
      "\\bsave\\b",
      "confirm",
    ],
    notAvailable: [
      "not\\s+(yet\\s+)?(been\\s+)?filed",
      "no\\s+record(s)?\\s+found",
      "no\\s+data\\s+(is\\s+)?available",
      "not\\s+(yet\\s+)?generated",
      "not\\s+(applicable|available)\\s+for\\s+(this|the\\s+selected)",
    ],
    sessionExpired: ["session\\s+(has\\s+)?expired", "session\\s*time\\s*-?\\s*out", "please\\s+log\\s*in\\s+again"],
    jsonPending: [
      "request\\s+for\\s+generation.*(accepted|under\\s+process|in\\s+progress)",
      "(being|is)\\s+(generated|prepared|processed)",
      "kindly\\s+wait",
      "available\\s+(for\\s+download\\s+)?(in|after)\\s+\\d+\\s*min",
    ],
  },
};

export const activePortalSettings = (): PortalSettings => BUILT_IN_SETTINGS;

// "What's new": a short card about each new feature, shown once to each
// person (remembered on their device), with "Show me" pointing at the real
// button. The cards live here in the code, not the database, so showing them
// costs nothing. Each card's push goes out once (lib/whats-new-server.ts).
//
// Adding a feature? Add its card at the TOP of ANNOUNCEMENTS and put
// data-showme="<target>" on the element "Show me" should point at.

// everyone: all staff · attendance: people who mark attendance · admin: admins
export type Audience = "everyone" | "attendance" | "admin";

interface Text {
  en: string;
  hi: string;
}

export interface Announcement {
  // Never change once live: it is how "seen" and "push sent" are remembered
  id: string;
  // Launch day (India), YYYY-MM-DD. The push goes out in the daily job on or
  // after this day, and only within PUSH_WINDOW_DAYS of it.
  date: string;
  audience: Audience;
  title: Text;
  steps: { en: string[]; hi: string[] };
  showMe?: { href: string; target: string; hint: Text };
  push: { title: string; body: string };
}

export const PUSH_WINDOW_DAYS = 7;
export const SEEN_KEY = "whats-new-seen-v1";
export const SHOW_ME_EVENT = "app:show-me";
export const TOUR_CLOSED_EVENT = "app:tour-closed";

// Newest first
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "attendance-alerts",
    date: "2026-11-03",
    audience: "admin",
    title: { en: "New: “Came to office” notifications", hi: "नया: “ऑफिस आए” सूचना" },
    steps: {
      en: [
        "Each time someone marks attendance, you get a notification: “Staff A came to office · 10:04 am”.",
        "To send these to partners too, turn them on under “Who gets came to office notifications” on Admin → Attendance.",
      ],
      hi: [
        "जब भी कोई हाज़िरी लगाता है, आपको सूचना मिलती है: “Staff A came to office · 10:04 am”।",
        "पार्टनर्स को भी भेजने के लिए, एडमिन → हाज़िरी में “Who gets came to office notifications” में उन्हें चालू करें।",
      ],
    },
    showMe: {
      href: "/dashboard/attendance",
      target: "attendance-alerts",
      hint: {
        en: "Turn on the partners who should get a notification when staff come in.",
        hi: "जिन पार्टनर्स को स्टाफ़ के आने की सूचना मिलनी चाहिए, उन्हें यहाँ चालू करें।",
      },
    },
    push: {
      title: "New in the app: Came to office notifications",
      body: "You now get a notification each time someone marks attendance. Tap to choose which partners get them too.",
    },
  },
  {
    id: "attendance-report",
    date: "2026-11-03",
    audience: "admin",
    title: { en: "New: Attendance report", hi: "नया: हाज़िरी रिपोर्ट" },
    steps: {
      en: [
        "Admin → Attendance shows who has marked attendance today, and the time each person marked on every day of the month (Sundays left out).",
        "Download the month for Excel with the Excel (CSV) button.",
        "Under “Who marks attendance”, turn off the partners (or anyone) who don't need to mark it. They won't see the button and won't be in the report.",
      ],
      hi: [
        "एडमिन → हाज़िरी में दिखता है कि आज किसने हाज़िरी लगाई, और महीने के हर दिन हर व्यक्ति ने किस समय लगाई (रविवार छोड़कर)।",
        "Excel (CSV) बटन से महीने की रिपोर्ट Excel के लिए डाउनलोड करें।",
        "“Who marks attendance” में उन पार्टनर्स (या किसी को भी) को बंद करें जिन्हें हाज़िरी नहीं लगानी है। उन्हें बटन नहीं दिखेगा और वे रिपोर्ट में नहीं होंगे।",
      ],
    },
    showMe: {
      href: "/dashboard/attendance",
      target: "attendance-switches",
      hint: {
        en: "Turn off here the partners who don't need to mark attendance.",
        hi: "जिन पार्टनर्स को हाज़िरी नहीं लगानी है, उन्हें यहाँ बंद करें।",
      },
    },
    push: {
      title: "New in the app: Attendance report",
      body: "See who marked attendance and when. Tap to see how, and choose who doesn't need to mark it.",
    },
  },
  {
    id: "attendance",
    date: "2026-11-03",
    audience: "attendance",
    title: { en: "New: Mark your attendance", hi: "नया: अपनी हाज़िरी लगाएँ" },
    steps: {
      en: [
        "When you reach the office, open Today.",
        "Tap Mark attendance. The time is saved automatically.",
        "Once a day is enough. No attendance on Sundays.",
      ],
      hi: [
        "ऑफिस पहुँचकर Today (आज) खोलें।",
        "हाज़िरी लगाएँ पर टैप करें। समय अपने आप सेव हो जाता है।",
        "दिन में एक बार काफ़ी है। रविवार को हाज़िरी नहीं।",
      ],
    },
    showMe: {
      href: "/dashboard/my-work",
      target: "mark-attendance",
      hint: {
        en: "Tap here each day when you reach the office.",
        hi: "रोज़ ऑफिस पहुँचकर यहाँ टैप करें।",
      },
    },
    push: {
      title: "New in the app: Attendance",
      body: "Mark your attendance on Today when you reach the office. Tap to see how.",
    },
  },
];

export function findAnnouncement(id: string) {
  return ANNOUNCEMENTS.find((a) => a.id === id);
}

// Without asking the server: could this role be in the audience?
export function roleMayBeInAudience(role: string, audience: Audience) {
  if (audience === "admin") return role === "ADMIN";
  if (audience === "attendance") return role !== "ADMIN";
  return true;
}

export function readSeen(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function markSeen(ids: string[]) {
  try {
    const seen = new Set(readSeen());
    ids.forEach((id) => seen.add(id));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage blocked: the card may show again
  }
}

// Open the page and point at the button
export function showMe(announcement: Announcement) {
  if (!announcement.showMe) return;
  window.dispatchEvent(new CustomEvent(SHOW_ME_EVENT, { detail: announcement.showMe }));
}

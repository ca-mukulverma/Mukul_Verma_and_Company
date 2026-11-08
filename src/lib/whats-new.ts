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
    id: "work-done",
    date: "2026-11-09",
    audience: "everyone",
    title: { en: "Work done: one list of finished work, and who did it", hi: "किया गया काम: पूरे हुए काम की एक सूची, और किसने किया" },
    steps: {
      en: [
        "Work done in the menu lists completed tasks, logged work and compliance returns filed, with the date, client and firm.",
        "You see your own work and how much you did this month. Admin, and the partners Admin allows, see everyone's, with a By staff count.",
        "Choose dates, firm or kind of work, search by client, and download it as Excel.",
      ],
      hi: [
        "मेन्यू में Work done में पूरे हुए टास्क, लॉग किया गया काम और फ़ाइल हुए कंप्लायंस रिटर्न दिखते हैं, तारीख, क्लाइंट और फ़र्म के साथ।",
        "आपको अपना काम और इस महीने कितना काम किया, दिखता है। एडमिन और जिन पार्टनर्स को एडमिन अनुमति दे, वे सबका काम और By staff गिनती देखते हैं।",
        "तारीख, फ़र्म या काम का प्रकार चुनें, क्लाइंट से खोजें, और Excel डाउनलोड करें।",
      ],
    },
    push: {
      title: "New in the app: Work done",
      body: "One list of finished tasks, logged work and compliance, with who did each one. Open Work done in the menu.",
    },
  },
  {
    id: "gst-portal-excel",
    date: "2026-11-08",
    audience: "everyone",
    title: { en: "GST portal box: tick a month, open saved files, Excel of GSTR-1 and GSTR-2B", hi: "GST पोर्टल बॉक्स: पूरा महीना टिक करें, सेव फ़ाइल खोलें, GSTR-1 और GSTR-2B का Excel" },
    steps: {
      en: [
        "In a client's GST portal box, the box before a month ticks every file of that month; \"Tick for the year\" ticks one return for all months.",
        "Click a green (saved) file to download it. A GSTR-2B in parts lists each part, with Download all.",
        "On a green GSTR-1 JSON or GSTR-2B, choose Excel: a sheet per section, as on the portal. The buttons at the top make one Excel for the whole year.",
      ],
      hi: [
        "क्लाइंट के GST पोर्टल बॉक्स में महीने के आगे वाला बॉक्स उस महीने की सारी फ़ाइलें टिक करता है; \"Tick for the year\" एक रिटर्न को सभी महीनों के लिए टिक करता है।",
        "हरी (सेव) फ़ाइल पर क्लिक करके उसे डाउनलोड करें। हिस्सों वाले GSTR-2B में हर हिस्सा दिखता है, साथ में Download all।",
        "हरे GSTR-1 JSON या GSTR-2B पर Excel चुनें: पोर्टल की तरह हर सेक्शन की अलग शीट। ऊपर के बटन पूरे साल का एक Excel बनाते हैं।",
      ],
    },
    push: {
      title: "New in the app: GST files as Excel",
      body: "In a client's GST portal box: tick a whole month, click a saved file to download it, and get GSTR-1 / GSTR-2B as Excel.",
    },
  },
  {
    id: "office-time",
    date: "2026-11-04",
    audience: "attendance",
    title: { en: "Office time: 11:30 AM", hi: "ऑफिस का समय: सुबह 11:30" },
    steps: {
      en: [
        "Office time is 11:30 AM. Marking attendance up to 11:35 AM is on time.",
        "After that, the app tells you how late you are, and the admin sees it too.",
        "If you haven't marked attendance by about 12 noon, you get a reminder.",
      ],
      hi: [
        "ऑफिस का समय सुबह 11:30 है। 11:35 तक हाज़िरी लगाना समय पर माना जाएगा।",
        "उसके बाद ऐप बताएगा कि आप कितनी देर से आए हैं, और एडमिन को भी दिखेगा।",
        "अगर लगभग 12 बजे तक हाज़िरी नहीं लगी, तो आपको याद दिलाया जाएगा।",
      ],
    },
    showMe: {
      href: "/dashboard/my-work",
      target: "mark-attendance",
      hint: {
        en: "Mark your attendance here by 11:30 AM.",
        hi: "सुबह 11:30 तक यहाँ हाज़िरी लगाएँ।",
      },
    },
    push: {
      title: "New in the app: Office time 11:30 AM",
      body: "Please mark attendance by 11:30 AM. Late marks are shown to you and the admin.",
    },
  },
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

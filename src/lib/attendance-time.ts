// Office time and lateness for attendance. No server imports, so the Today
// card and the admin's report use the same rules as the server.
//
// Office starts at 11:30 AM India time. Marking up to 11:35 AM (5 minutes'
// grace) is on time; after that the person is late, counted from 11:30.

export const OFFICE_START_LABEL = "11:30 AM";
const OFFICE_START_MINUTES = 11 * 60 + 30; // minutes after midnight, India time
export const GRACE_MINUTES = 5;
// From the 4th late day in a month the message gets firmer
export const POLITE_LATE_DAYS = 3;

const IST_OFFSET_MINUTES = 5 * 60 + 30; // India has no daylight saving

// Minutes late after 11:30 AM India time; 0 when on time or within the grace
export function minutesLate(markedAt: Date | string): number {
  const ms = new Date(markedAt).getTime();
  const istMinutes = Math.floor(ms / 60_000 + IST_OFFSET_MINUTES);
  const minuteOfDay = ((istMinutes % 1440) + 1440) % 1440;
  const late = minuteOfDay - OFFICE_START_MINUTES;
  return late > GRACE_MINUTES ? late : 0;
}

// "22 minutes", "1 hour", "1 hour 5 minutes"
export function lateText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = m ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return [hours, mins].filter(Boolean).join(" ");
}

// Short form for tables and notifications: "22 min", "1 h 5 min"
export function lateShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

// The message shown to the person when they mark attendance late. Polite for
// the first few late days of the month, firmer after that.
export function lateMessage(minutes: number, lateDaysThisMonth: number, language: "en" | "hi" = "en") {
  const firm = lateDaysThisMonth > POLITE_LATE_DAYS;
  if (language === "hi") {
    const late = hindiLate(minutes);
    return firm
      ? {
          title: `आप आज ${late} देर से आए हैं`,
          body: `इस महीने यह आपका ${lateDaysThisMonth}वाँ देर वाला दिन है। ऑफिस का समय सुबह 11:30 है। कल से समय पर आएँ।`,
        }
      : {
          title: `आप आज ${late} देर से आए हैं`,
          body: "ऑफिस का समय सुबह 11:30 है। कृपया समय पर आने की कोशिश करें।",
        };
  }
  return firm
    ? {
        title: `You are ${lateText(minutes)} late today`,
        body: `This is your ${ordinal(lateDaysThisMonth)} late day this month. Office time is ${OFFICE_START_LABEL}. Please come on time from tomorrow.`,
      }
    : {
        title: `You are ${lateText(minutes)} late today`,
        body: `Office time is ${OFFICE_START_LABEL}. Please try to come on time.`,
      };
}

function hindiLate(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} घंटे` : "", m ? `${m} मिनट` : ""].filter(Boolean).join(" ");
}

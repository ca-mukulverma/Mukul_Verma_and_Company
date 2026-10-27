// Works out which month a return file is for from its name, so many past
// period files can be dropped at once. GST portal downloads carry the period,
// e.g. "GSTR3B_23ABCDE1234F1Z5_102024.pdf" or "returns_R1_Oct-2024.json".

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

// "2024-10" for October 2024; null when the name has no clear month
export function monthFromFileName(fileName: string): string | null {
  const name = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "");

  // Oct-2024, October 2024, oct24
  const named = name.match(/(?<![a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_.'-]*(20\d{2}|\d{2})(?!\d)/);
  if (named) return key(fullYear(named[2]), MONTH_NAMES.indexOf(named[1]) + 1);

  // 102024, 10-2024, 10_2024 (month then year)
  const monthYear = name.match(/(?<!\d)(0[1-9]|1[0-2])[-_.]?(20\d{2})(?!\d)/);
  if (monthYear) return key(Number(monthYear[2]), Number(monthYear[1]));

  // 2024-10, 202410 (year then month)
  const yearMonth = name.match(/(?<!\d)(20\d{2})[-_.]?(0[1-9]|1[0-2])(?!\d)/);
  if (yearMonth) return key(Number(yearMonth[1]), Number(yearMonth[2]));

  return null;
}

// Return JSON for .json (and a .zip with "json" in its name), else the return PDF
export function returnFileKind(fileName: string): "RETURN_PDF" | "RETURN_JSON" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "RETURN_JSON";
  if (lower.endsWith(".zip")) return lower.includes("json") ? "RETURN_JSON" : "RETURN_PDF";
  if (lower.endsWith(".pdf")) return "RETURN_PDF";
  return null;
}

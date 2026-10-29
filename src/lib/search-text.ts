// Forgiving search for lists: every word typed must appear somewhere, in any
// order, ignoring case, dashes and spaces, so "3b sep pdf", "gstr3b" and
// "city sep 2026" all find "CITY MOTORS - GSTR-3B - Sep 2026.pdf".

const MONTH_WORDS: Record<string, string> = {
  january: "jan", february: "feb", march: "mar", april: "apr", june: "jun", july: "jul",
  august: "aug", september: "sep", sept: "sep", october: "oct", november: "nov", december: "dec",
};

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => MONTH_WORDS[w] ?? w);

export function matchesSearch(query: string, ...fields: (string | null | undefined)[]) {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const haystack = words(fields.filter(Boolean).join(" "));
  const spaced = ` ${haystack.join(" ")}`;
  const joined = haystack.join("");
  return wanted.every((w) => spaced.includes(` ${w}`) || joined.includes(w));
}

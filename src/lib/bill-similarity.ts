// How alike two pieces of billed work are, from the words of their first
// line, leaving out small words. Months and years ("September 2026") are kept
// apart: for fees they don't matter ("GSTR-3B for September 2026" and "GSTR 3B
// – Oct 2026" are the same kind of work); to spot work logged twice they must
// match, so next month's return is not taken for a repeat.

const SMALL_WORDS = new Set(["for", "of", "the", "and", "to", "in", "fy", "month", "quarter"]);
// Each month under one name, however it is written
const MONTHS: Record<string, string> = {
  jan: "jan", january: "jan", feb: "feb", february: "feb", mar: "mar", march: "mar", apr: "apr", april: "apr",
  may: "may", jun: "jun", june: "jun", jul: "jul", july: "jul", aug: "aug", august: "aug", sep: "sep",
  sept: "sep", september: "sep", oct: "oct", october: "oct", nov: "nov", november: "nov", dec: "dec",
  december: "dec",
};
const isYear = (w: string) => /^(19|20)\d\d$/.test(w);

function words(description: string) {
  return description
    .split("\n")[0]
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !SMALL_WORDS.has(w));
}

// What was done, without the period it was for
export function workWords(description: string) {
  return new Set(words(description).filter((w) => !MONTHS[w] && !isYear(w)));
}

// The months and years the work names
function periodWords(description: string) {
  return new Set(words(description).flatMap((w) => (MONTHS[w] ? [MONTHS[w]] : isYear(w) ? [w] : [])));
}

// 0 (nothing shared) to 1 (all the words of the shorter one are in the other)
export function workSimilarity(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  return [...a].filter((w) => b.has(w)).length / Math.min(a.size, b.size);
}

// Same kind of work (fee hints)
export const SIMILAR_WORK = 0.5;

// Probably the same work logged twice: the same work for the same period
// (when either names one)
export function isLikelyRepeat(a: string, b: string) {
  const periodsA = periodWords(a);
  const periodsB = periodWords(b);
  if (periodsA.size !== periodsB.size || [...periodsA].some((p) => !periodsB.has(p))) return false;
  return workSimilarity(workWords(a), workWords(b)) >= 0.8;
}

// Turns the text pieces of a PDF page (as pdf.js gives them) into lines, top
// to bottom. The portal's "FILED"/"FINAL" watermark is drawn rotated, so
// rotated text is left out.

export interface TextPiece {
  str: string;
  // pdf.js transform: [a, b, c, d, x, y]
  transform: number[];
  width: number;
}

export function pageLines(pieces: TextPiece[]): string[] {
  const upright = pieces.filter((p) => p.transform[1] === 0 && p.transform[2] === 0 && p.str !== "");
  upright.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const rows: TextPiece[][] = [];
  for (const piece of upright) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].transform[5] - piece.transform[5]) <= 2) row.push(piece);
    else rows.push([piece]);
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.transform[4] - b.transform[4]);
      let text = "";
      let end = -Infinity;
      for (const piece of row) {
        // Pieces apart from each other are separate words or columns
        if (text && piece.transform[4] - end > 1 && !text.endsWith(" ") && !piece.str.startsWith(" ")) text += " ";
        text += piece.str;
        end = piece.transform[4] + piece.width;
      }
      return text.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

const AMOUNT = /^(-?[\d,]*\d\.\d{1,2}|-)$/;

// The amounts at the end of a line ("-" for a cell that doesn't apply)
export function trailingAmounts(line: string): number[] {
  const tokens = line.split(" ");
  const out: number[] = [];
  for (let i = tokens.length - 1; i >= 0 && AMOUNT.test(tokens[i]); i--) {
    out.unshift(tokens[i] === "-" ? 0 : Number(tokens[i].replace(/,/g, "")));
  }
  return out;
}

// The amounts of a table row: on the label's line or the first line after it
// that ends in amounts (long labels wrap above or below their numbers)
export function amountsAfter(lines: string[], start: number, min = 1, lookahead = 6): number[] | null {
  for (let i = start; i < Math.min(lines.length, start + lookahead); i++) {
    const amounts = trailingAmounts(lines[i]);
    if (amounts.length >= min) return amounts;
  }
  return null;
}

export function findLine(lines: string[], pattern: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (pattern.test(lines[i])) return i;
  return -1;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "2026-27" + "June" → "2026-06"; "Apr-Jun" → the quarter's last month
export function monthOfPeriod(fy: string, period: string): { month: string; quarterly: boolean } | null {
  const start = Number(fy.slice(0, 4));
  const names = period.toLowerCase().split(/\s*[-–]\s*/);
  const index = MONTHS.indexOf(names[names.length - 1].slice(0, 3)) + 1;
  if (!start || index < 1) return null;
  const year = index >= 4 ? start : start + 1;
  return { month: `${year}-${String(index).padStart(2, "0")}`, quarterly: names.length > 1 };
}

// "20/07/2026" → "2026-07-20"
export function isoDate(text: string | undefined): string | null {
  const m = text?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

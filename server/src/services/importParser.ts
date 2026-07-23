/** Entfernt eine feste Anzahl führender Zeilen, z. B. Metadaten vor der eigentlichen Überschriftenzeile. */
export function applySkipRows(text: string, skipRows: number): string {
  if (!skipRows || skipRows <= 0) return text;
  return text.split(/\r?\n/).slice(skipRows).join("\n");
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const semicolons = firstLine.split(";").length;
  const commas = firstLine.split(",").length;
  const tabs = firstLine.split("\t").length;
  if (tabs > semicolons && tabs > commas) return "\t";
  return semicolons >= commas ? ";" : ",";
}

export function parseCsv(text: string, delimiter: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => splitCsvLine(line, delimiter));
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

/** Parses German/European-style amounts like "1.234,56", "-12,34" or plain "12.34" into cents. */
export function parseAmountToCents(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Whichever separator appears last is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Parses dates in formats DD.MM.YYYY, YYYY-MM-DD, or DD/MM/YYYY into ISO YYYY-MM-DD. */
export function parseDateToIso(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

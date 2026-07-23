const GERMAN_MONTHS =
  "januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|mrz|apr|jun|jul|aug|sep|sept|okt|nov|dez";
const MONTH_PATTERN = new RegExp(`\\b(${GERMAN_MONTHS})\\b`, "gi");

/** Normalisiert einen Buchungstext für den Ähnlichkeitsvergleich: Kleinschreibung, Ziffern/Monatsnamen/Satzzeichen raus. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(MONTH_PATTERN, " ")
    .replace(/\d+/g, " ")
    .replace(/[.,;:\/\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard-Ähnlichkeit der Wortmengen zweier normalisierter Texte, 0..1. */
export function tokenSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForMatch(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeForMatch(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

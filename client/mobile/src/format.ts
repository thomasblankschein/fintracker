const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export const formatCents = (cents: number): string => eur.format(cents / 100);

/** "12,50", "12.5", "12" → Cent; alles andere (mehr als 2 Nachkommastellen, Buchstaben, 0) → null. */
export function parseAmountToCents(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(/€/g, "");
  const m = s.match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return cents > 0 ? cents : null;
}

/** Lokales Datum des Geräts als YYYY-MM-DD (nicht UTC, sonst stimmt der Tag nach Mitternacht nicht). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

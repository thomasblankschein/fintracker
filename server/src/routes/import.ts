import { Router } from "express";
import { db, transaction } from "../db.js";
import { applySkipRows, detectDelimiter, parseCsv, parseAmountToCents, parseDateToIso } from "../services/importParser.js";
import { tokenSimilarity } from "../services/similarity.js";

export const importRouter = Router();

const DUPLICATE_WINDOW_DAYS = 3;

interface ColumnMapping {
  date: number;
  amount: number;
  description?: number;
  payee?: number;
}

function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftDate(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DuplicateMatch {
  transactionId: number;
  date: string;
  description: string | null;
}

/**
 * Findet eine bereits vorhandene Buchung auf demselben Konto mit exakt gleichem
 * (vorzeichenbehaftetem) Betrag innerhalb eines Datumsfensters. Bewusst ohne
 * Text-Abgleich: derselbe Ausgleich Girokonto<->Kreditkarte liest sich auf beiden
 * Kontoauszügen meist völlig unterschiedlich.
 */
function findDuplicate(accountId: number, amountCents: number, date: string): DuplicateMatch | null {
  const from = shiftDate(date, -DUPLICATE_WINDOW_DAYS);
  const to = shiftDate(date, DUPLICATE_WINDOW_DAYS);
  const row = db
    .prepare(
      `SELECT t.id AS transactionId, t.date, t.description
       FROM postings po
       JOIN transactions t ON t.id = po.transaction_id
       WHERE po.account_id = ? AND po.amount_cents = ? AND t.date BETWEEN ? AND ?
       ORDER BY ABS(julianday(t.date) - julianday(?))
       LIMIT 1`
    )
    .get(accountId, amountCents, from, to, date) as
    | { transactionId: number; date: string; description: string | null }
    | undefined;
  return row ?? null;
}

importRouter.post("/parse", (req, res) => {
  const { csvText, skipRows } = req.body ?? {};
  if (!csvText || typeof csvText !== "string") {
    return res.status(400).json({ error: "csvText ist erforderlich." });
  }
  const relevantText = applySkipRows(csvText, Number(skipRows) || 0);
  const delimiter = detectDelimiter(relevantText);
  const rows = parseCsv(relevantText, delimiter);
  if (rows.length === 0) return res.status(400).json({ error: "Datei ist leer." });
  res.json({
    delimiter,
    headers: rows[0],
    sampleRows: rows.slice(1, 6),
    rowCount: rows.length - 1,
  });
});

function suggestCategoryForPayee(payeeName: string | undefined): { id: number; name: string } | null {
  if (!payeeName) return null;
  const row = db
    .prepare(
      `SELECT a.id, a.name, COUNT(*) AS cnt
       FROM transactions t
       JOIN payees p ON p.id = t.payee_id
       JOIN postings po ON po.transaction_id = t.id
       JOIN accounts a ON a.id = po.account_id
       WHERE p.name = ? AND a.type IN ('expense', 'income')
       GROUP BY a.id, a.name
       ORDER BY cnt DESC
       LIMIT 1`
    )
    .get(payeeName) as { id: number; name: string; cnt: number } | undefined;
  return row ? { id: row.id, name: row.name } : null;
}

const SIMILARITY_THRESHOLD = 0.5;

interface SimilarBookingMatch {
  accountId: number;
  accountName: string;
  transactionId: number;
  date: string;
  description: string | null;
}

/**
 * Fällt zurück auf eine unscharfe Erkennung, wenn kein bekannter Zahlungsempfänger passt: sucht frühere
 * Buchungen auf demselben Konto mit exakt demselben Betrag (Kandidaten, per SQL vorgefiltert) und wählt
 * per Wort-Überlappung im Verwendungszweck die ähnlichste — z. B. "Miete Juli" vs. "Miete August".
 */
function suggestCategoryBySimilarBooking(
  accountId: number,
  amountCents: number,
  description: string
): SimilarBookingMatch | null {
  if (!description.trim()) return null;
  const candidates = db
    .prepare(
      `SELECT t.id AS transactionId, t.date, t.description, po2.account_id AS categoryAccountId, a.name AS categoryAccountName
       FROM postings po
       JOIN transactions t ON t.id = po.transaction_id
       JOIN postings po2 ON po2.transaction_id = t.id AND po2.account_id != po.account_id
       JOIN accounts a ON a.id = po2.account_id
       WHERE po.account_id = ? AND po.amount_cents = ?
         AND (SELECT COUNT(*) FROM postings WHERE transaction_id = t.id) = 2
       ORDER BY t.date DESC
       LIMIT 50`
    )
    .all(accountId, amountCents) as {
    transactionId: number;
    date: string;
    description: string | null;
    categoryAccountId: number;
    categoryAccountName: string;
  }[];

  let best: (typeof candidates)[number] | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = tokenSimilarity(description, c.description ?? "");
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best || bestScore < SIMILARITY_THRESHOLD) return null;
  return {
    accountId: best.categoryAccountId,
    accountName: best.categoryAccountName,
    transactionId: best.transactionId,
    date: best.date,
    description: best.description,
  };
}

importRouter.post("/preview", (req, res) => {
  const { csvText, delimiter, mapping, hasHeader, defaultAccountId, skipRows } = req.body as {
    csvText: string;
    delimiter: string;
    mapping: ColumnMapping;
    hasHeader: boolean;
    defaultAccountId: number;
    skipRows?: number;
  };
  if (!csvText || !mapping || mapping.date === undefined || mapping.amount === undefined) {
    return res.status(400).json({ error: "csvText und mapping (date, amount) sind erforderlich." });
  }
  if (!defaultAccountId) {
    return res.status(400).json({ error: "defaultAccountId ist erforderlich (Ziel-Konto der CSV)." });
  }

  const allRows = parseCsv(applySkipRows(csvText, Number(skipRows) || 0), delimiter);
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  const preview = dataRows.map((row, index) => {
    const rawDate = row[mapping.date] ?? "";
    const rawAmount = row[mapping.amount] ?? "";
    const description = mapping.description !== undefined ? row[mapping.description] ?? "" : "";
    const payeeName = mapping.payee !== undefined ? (row[mapping.payee] ?? "").trim() : "";

    const date = parseDateToIso(rawDate);
    const amountCents = parseAmountToCents(rawAmount);
    const paySuggestion = suggestCategoryForPayee(payeeName);
    const similarSuggestion =
      !paySuggestion && amountCents !== null
        ? suggestCategoryBySimilarBooking(defaultAccountId, amountCents, description)
        : null;
    const duplicateOf = date !== null && amountCents !== null ? findDuplicate(defaultAccountId, amountCents, date) : null;

    return {
      rowIndex: index,
      date,
      rawDate,
      amountCents,
      description,
      payeeName: payeeName || null,
      suggestedCategoryAccountId: paySuggestion?.id ?? similarSuggestion?.accountId ?? null,
      suggestedCategoryAccountName: paySuggestion?.name ?? similarSuggestion?.accountName ?? null,
      suggestionSource: paySuggestion ? "payee" : similarSuggestion ? "similarBooking" : null,
      similarBookingOf: similarSuggestion
        ? { transactionId: similarSuggestion.transactionId, date: similarSuggestion.date, description: similarSuggestion.description }
        : null,
      possibleDuplicate: duplicateOf !== null,
      duplicateOf,
      valid: date !== null && amountCents !== null && amountCents !== 0,
    };
  });

  res.json({ rows: preview });
});

importRouter.post("/commit", (req, res) => {
  const { defaultAccountId, rows } = req.body as {
    defaultAccountId: number;
    rows: {
      date: string;
      amountCents: number;
      description: string;
      payeeName: string | null;
      categoryAccountId: number;
    }[];
  };

  if (!defaultAccountId || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "defaultAccountId und rows sind erforderlich." });
  }

  const findOrCreatePayee = (name: string | null): number | null => {
    if (!name) return null;
    const existing = db.prepare("SELECT id FROM payees WHERE name = ?").get(name) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(db.prepare("INSERT INTO payees (name) VALUES (?)").run(name).lastInsertRowid);
  };

  let created = 0;
  transaction(() => {
    for (const row of rows) {
      if (!row.categoryAccountId || !row.date || !row.amountCents) continue;
      const payeeId = findOrCreatePayee(row.payeeName);
      const txResult = db
        .prepare("INSERT INTO transactions (date, description, payee_id) VALUES (?, ?, ?)")
        .run(row.date, row.description ?? null, payeeId);
      const txId = Number(txResult.lastInsertRowid);
      db.prepare("INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)").run(
        txId,
        defaultAccountId,
        Math.round(row.amountCents)
      );
      db.prepare("INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)").run(
        txId,
        row.categoryAccountId,
        -Math.round(row.amountCents)
      );
      created++;
    }
  });

  res.status(201).json({ created });
});

import { Router } from "express";
import { db, transaction } from "../db.js";
import { detectDelimiter, parseCsv, parseAmountToCents, parseDateToIso } from "../services/importParser.js";

export const importRouter = Router();

interface ColumnMapping {
  date: number;
  amount: number;
  description?: number;
  payee?: number;
}

importRouter.post("/parse", (req, res) => {
  const { csvText } = req.body ?? {};
  if (!csvText || typeof csvText !== "string") {
    return res.status(400).json({ error: "csvText ist erforderlich." });
  }
  const delimiter = detectDelimiter(csvText);
  const rows = parseCsv(csvText, delimiter);
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

importRouter.post("/preview", (req, res) => {
  const { csvText, delimiter, mapping, hasHeader } = req.body as {
    csvText: string;
    delimiter: string;
    mapping: ColumnMapping;
    hasHeader: boolean;
  };
  if (!csvText || !mapping || mapping.date === undefined || mapping.amount === undefined) {
    return res.status(400).json({ error: "csvText und mapping (date, amount) sind erforderlich." });
  }

  const allRows = parseCsv(csvText, delimiter);
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  const preview = dataRows.map((row, index) => {
    const rawDate = row[mapping.date] ?? "";
    const rawAmount = row[mapping.amount] ?? "";
    const description = mapping.description !== undefined ? row[mapping.description] ?? "" : "";
    const payeeName = mapping.payee !== undefined ? (row[mapping.payee] ?? "").trim() : "";

    const date = parseDateToIso(rawDate);
    const amountCents = parseAmountToCents(rawAmount);
    const suggestion = suggestCategoryForPayee(payeeName || description);

    return {
      rowIndex: index,
      date,
      rawDate,
      amountCents,
      description,
      payeeName: payeeName || null,
      suggestedCategoryAccountId: suggestion?.id ?? null,
      suggestedCategoryAccountName: suggestion?.name ?? null,
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

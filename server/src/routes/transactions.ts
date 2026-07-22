import { Router } from "express";
import { db, transaction } from "../db.js";

export const transactionsRouter = Router();

interface PostingInput {
  accountId: number;
  amountCents: number;
}

function findOrCreatePayee(payeeId?: number | null, payeeName?: string | null): number | null {
  if (payeeId) return payeeId;
  const trimmed = payeeName?.trim();
  if (!trimmed) return null;
  const existing = db.prepare("SELECT id FROM payees WHERE name = ?").get(trimmed) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const result = db.prepare("INSERT INTO payees (name) VALUES (?)").run(trimmed);
  return Number(result.lastInsertRowid);
}

function validatePostings(postings: PostingInput[]): string | null {
  if (!Array.isArray(postings) || postings.length < 2) {
    return "Eine Buchung benötigt mindestens zwei Buchungszeilen.";
  }
  for (const p of postings) {
    if (typeof p.accountId !== "number" || typeof p.amountCents !== "number" || !Number.isFinite(p.amountCents)) {
      return "Jede Buchungszeile benötigt ein gültiges Konto und einen Betrag.";
    }
    if (p.amountCents === 0) {
      return "Buchungszeilen mit Betrag 0 sind nicht erlaubt.";
    }
  }
  const sum = postings.reduce((s, p) => s + Math.round(p.amountCents), 0);
  if (sum !== 0) {
    return `Die Buchungszeilen müssen sich zu 0 summieren (aktuell: ${sum} Cent).`;
  }
  return null;
}

/** Liefert die ID des Kontos selbst plus aller (rekursiven) Unterkonten. */
function collectSubtreeIds(rootId: number): number[] {
  const all = db.prepare("SELECT id, parent_id FROM accounts").all() as unknown as {
    id: number;
    parent_id: number | null;
  }[];
  const byParent = new Map<number, number[]>();
  for (const a of all) {
    if (a.parent_id !== null) {
      if (!byParent.has(a.parent_id)) byParent.set(a.parent_id, []);
      byParent.get(a.parent_id)!.push(a.id);
    }
  }
  const ids = [rootId];
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const childId of byParent.get(current) ?? []) {
      ids.push(childId);
      stack.push(childId);
    }
  }
  return ids;
}

function serializeTransaction(t: any, postings: any[]) {
  return {
    id: t.id,
    date: t.date,
    description: t.description,
    payeeId: t.payee_id,
    payeeName: t.payee_name ?? null,
    postings: postings.map((p) => ({
      id: p.id,
      accountId: p.account_id,
      accountName: p.account_name,
      amountCents: p.amount_cents,
    })),
  };
}

transactionsRouter.get("/", (req, res) => {
  const { account, payee, from, to, description } = req.query as Record<string, string | undefined>;

  let txIds: number[] | null = null;
  if (account) {
    const accountIds = collectSubtreeIds(Number(account));
    txIds = (
      db
        .prepare(
          `SELECT DISTINCT transaction_id AS id FROM postings WHERE account_id IN (${accountIds.map(() => "?").join(",")})`
        )
        .all(...accountIds) as { id: number }[]
    ).map((r) => r.id);
  }

  let sql = `SELECT t.*, p.name AS payee_name FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id WHERE 1=1`;
  const params: any[] = [];
  if (payee) {
    sql += " AND t.payee_id = ?";
    params.push(Number(payee));
  }
  if (from) {
    sql += " AND t.date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND t.date <= ?";
    params.push(to);
  }
  if (description) {
    sql += " AND t.description LIKE ?";
    params.push(`%${description}%`);
  }
  if (txIds) {
    if (txIds.length === 0) return res.json([]);
    sql += ` AND t.id IN (${txIds.map(() => "?").join(",")})`;
    params.push(...txIds);
  }
  sql += " ORDER BY t.date DESC, t.id DESC";

  const txs = db.prepare(sql).all(...params) as any[];
  const postingStmt = db.prepare(
    `SELECT po.*, a.name AS account_name FROM postings po JOIN accounts a ON a.id = po.account_id WHERE po.transaction_id = ?`
  );
  res.json(txs.map((t) => serializeTransaction(t, postingStmt.all(t.id))));
});

transactionsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const t = db
    .prepare(`SELECT t.*, p.name AS payee_name FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id WHERE t.id = ?`)
    .get(id) as any;
  if (!t) return res.status(404).json({ error: "Buchung nicht gefunden." });
  const postings = db
    .prepare(`SELECT po.*, a.name AS account_name FROM postings po JOIN accounts a ON a.id = po.account_id WHERE po.transaction_id = ?`)
    .all(id);
  res.json(serializeTransaction(t, postings));
});

transactionsRouter.post("/", (req, res) => {
  const { date, description, payeeId, payeeName, postings } = req.body ?? {};
  if (!date || typeof date !== "string") {
    return res.status(400).json({ error: "Datum ist erforderlich." });
  }
  const validationError = validatePostings(postings);
  if (validationError) return res.status(400).json({ error: validationError });

  const resolvedPayeeId = findOrCreatePayee(payeeId, payeeName);

  const result = transaction(() => {
    const txResult = db
      .prepare("INSERT INTO transactions (date, description, payee_id) VALUES (?, ?, ?)")
      .run(date, description ?? null, resolvedPayeeId);
    const txId = Number(txResult.lastInsertRowid);
    const insertPosting = db.prepare(
      "INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)"
    );
    for (const p of postings as PostingInput[]) {
      insertPosting.run(txId, p.accountId, Math.round(p.amountCents));
    }
    return txId;
  });

  res.status(201).json({ id: result });
});

transactionsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Buchung nicht gefunden." });

  const { date, description, payeeId, payeeName, postings } = req.body ?? {};
  if (postings !== undefined) {
    const validationError = validatePostings(postings);
    if (validationError) return res.status(400).json({ error: validationError });
  }
  const resolvedPayeeId = payeeId !== undefined || payeeName !== undefined ? findOrCreatePayee(payeeId, payeeName) : undefined;

  transaction(() => {
    if (date !== undefined) db.prepare("UPDATE transactions SET date = ? WHERE id = ?").run(date, id);
    if (description !== undefined) db.prepare("UPDATE transactions SET description = ? WHERE id = ?").run(description, id);
    if (resolvedPayeeId !== undefined) db.prepare("UPDATE transactions SET payee_id = ? WHERE id = ?").run(resolvedPayeeId, id);
    if (postings !== undefined) {
      db.prepare("DELETE FROM postings WHERE transaction_id = ?").run(id);
      const insertPosting = db.prepare(
        "INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)"
      );
      for (const p of postings as PostingInput[]) {
        insertPosting.run(id, p.accountId, Math.round(p.amountCents));
      }
    }
  });

  res.json({ ok: true });
});

transactionsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  res.json({ ok: true });
});

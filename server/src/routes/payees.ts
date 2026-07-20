import { Router } from "express";
import { db } from "../db.js";

export const payeesRouter = Router();

payeesRouter.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name,
              COALESCE(SUM(CASE WHEN a.type = 'expense' THEN po.amount_cents ELSE 0 END), 0) AS expense_total,
              COUNT(DISTINCT t.id) AS transaction_count
       FROM payees p
       LEFT JOIN transactions t ON t.payee_id = p.id
       LEFT JOIN postings po ON po.transaction_id = t.id
       LEFT JOIN accounts a ON a.id = po.account_id
       GROUP BY p.id, p.name
       ORDER BY p.name`
    )
    .all() as any[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      expenseTotal: r.expense_total,
      transactionCount: r.transaction_count,
    }))
  );
});

payeesRouter.post("/", (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name ist erforderlich." });
  }
  try {
    const result = db.prepare("INSERT INTO payees (name) VALUES (?)").run(name.trim());
    res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      const existing = db.prepare("SELECT id FROM payees WHERE name = ?").get(name.trim()) as { id: number };
      return res.status(200).json({ id: existing.id, name: name.trim() });
    }
    throw e;
  }
});

payeesRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "Name ist erforderlich." });
  db.prepare("UPDATE payees SET name = ? WHERE id = ?").run(name.trim(), id);
  res.json({ ok: true });
});

payeesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const used = (
    db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE payee_id = ?").get(id) as { c: number }
  ).c;
  if (used > 0) {
    return res.status(400).json({ error: "Zahlungsempfänger wird noch in Buchungen verwendet." });
  }
  db.prepare("DELETE FROM payees WHERE id = ?").run(id);
  res.json({ ok: true });
});

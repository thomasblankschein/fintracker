import { Router } from "express";
import { db } from "../db.js";

export const reportsRouter = Router();

function dateFilter(from?: string, to?: string) {
  const clauses: string[] = [];
  const params: any[] = [];
  if (from) {
    clauses.push("t.date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("t.date <= ?");
    params.push(to);
  }
  return { clause: clauses.length ? "AND " + clauses.join(" AND ") : "", params };
}

reportsRouter.get("/by-category", (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const { clause, params } = dateFilter(from, to);

  const rows = db
    .prepare(
      `SELECT a.id AS account_id, a.name AS account_name, a.type AS account_type,
              SUM(CASE WHEN a.type = 'expense' THEN po.amount_cents ELSE -po.amount_cents END) AS total
       FROM postings po
       JOIN accounts a ON a.id = po.account_id
       JOIN transactions t ON t.id = po.transaction_id
       WHERE a.type IN ('expense', 'income') ${clause}
       GROUP BY a.id, a.name, a.type
       ORDER BY total DESC`
    )
    .all(...params) as any[];

  res.json(
    rows.map((r) => ({
      accountId: r.account_id,
      accountName: r.account_name,
      accountType: r.account_type,
      totalCents: r.total,
    }))
  );
});

reportsRouter.get("/by-payee", (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const { clause, params } = dateFilter(from, to);

  const rows = db
    .prepare(
      `SELECT p.id AS payee_id, p.name AS payee_name,
              SUM(CASE WHEN a.type = 'expense' THEN po.amount_cents ELSE 0 END) AS expense_total,
              SUM(CASE WHEN a.type = 'income' THEN -po.amount_cents ELSE 0 END) AS income_total
       FROM transactions t
       JOIN payees p ON p.id = t.payee_id
       JOIN postings po ON po.transaction_id = t.id
       JOIN accounts a ON a.id = po.account_id
       WHERE 1=1 ${clause}
       GROUP BY p.id, p.name
       ORDER BY expense_total DESC`
    )
    .all(...params) as any[];

  res.json(
    rows.map((r) => ({
      payeeId: r.payee_id,
      payeeName: r.payee_name,
      expenseTotalCents: r.expense_total,
      incomeTotalCents: r.income_total,
    }))
  );
});

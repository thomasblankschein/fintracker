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

interface CategoryAccountRow {
  id: number;
  name: string;
  type: string;
  parent_id: number | null;
}

/**
 * Summe pro Kategorie-Konto inkl. aller Unterkonten (rekursiv) — analog zum
 * Saldo-Rollup im Kontenrahmen (accounts.ts buildTree), damit Auswertungen und
 * Konten-Ansicht konsistent bleiben, egal wie tief die Kategorie-Hierarchie ist.
 */
reportsRouter.get("/by-category", (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const { clause, params } = dateFilter(from, to);

  const ownRows = db
    .prepare(
      `SELECT a.id AS account_id,
              SUM(CASE WHEN a.type = 'expense' THEN po.amount_cents ELSE -po.amount_cents END) AS total
       FROM postings po
       JOIN accounts a ON a.id = po.account_id
       JOIN transactions t ON t.id = po.transaction_id
       WHERE a.type IN ('expense', 'income') ${clause}
       GROUP BY a.id`
    )
    .all(...params) as { account_id: number; total: number }[];
  const ownTotals = new Map(ownRows.map((r) => [r.account_id, r.total]));

  const accounts = db
    .prepare("SELECT id, name, type, parent_id FROM accounts WHERE type IN ('expense', 'income')")
    .all() as unknown as CategoryAccountRow[];

  const byParent = new Map<number | null, CategoryAccountRow[]>();
  for (const a of accounts) {
    const key = a.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  const totalsById = new Map<number, number>();
  function computeTotal(a: CategoryAccountRow): number {
    const own = ownTotals.get(a.id) ?? 0;
    const total = own + (byParent.get(a.id) ?? []).reduce((sum, c) => sum + computeTotal(c), 0);
    totalsById.set(a.id, total);
    return total;
  }
  for (const root of byParent.get(null) ?? []) computeTotal(root);

  const result: {
    accountId: number;
    accountName: string;
    accountType: string;
    parentId: number | null;
    depth: number;
    totalCents: number;
  }[] = [];
  function collect(a: CategoryAccountRow, depth: number) {
    const total = totalsById.get(a.id) ?? 0;
    // depth 0 = Wurzelknoten "Aufwendungen"/"Erträge" selbst, wird nicht einzeln ausgewiesen
    // (die Summe steht bereits als Gesamt-Stat auf der Auswertungsseite).
    if (depth > 0 && total !== 0) {
      result.push({ accountId: a.id, accountName: a.name, accountType: a.type, parentId: a.parent_id, depth, totalCents: total });
    }
    for (const c of byParent.get(a.id) ?? []) collect(c, depth + 1);
  }
  for (const root of byParent.get(null) ?? []) collect(root, 0);

  res.json(result);
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

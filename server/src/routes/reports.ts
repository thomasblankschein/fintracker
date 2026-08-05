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

/** Liefert die gewählten Konto-IDs plus alle (rekursiven) Unterkonten. Spiegelt collectSubtreeIds in transactions.ts. */
function expandSubtrees(rootIds: number[]): Set<number> {
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
  const ids = new Set<number>();
  const stack = [...rootIds];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const childId of byParent.get(current) ?? []) stack.push(childId);
  }
  return ids;
}

type MoneyUsageDirection = "herkunft" | "verwendung";
type MoneyUsageBucket =
  | "konsum"
  | "vermoegensbildung"
  | "tilgung"
  | "einnahmen"
  | "vermoegensaufloesung"
  | "kreditaufnahme"
  | "eigenkapital";

/** Ordnet ein Gegenkonto (Typ + Vorzeichen der Summe) einer Richtung + einem Topf zu. */
function classify(type: string, total: number): { direction: MoneyUsageDirection; bucket: MoneyUsageBucket } {
  const outflow = total > 0; // positiv = Zuwachs beim Gegenkonto = Abfluss aus den liquiden Mitteln
  switch (type) {
    case "expense":
      return { direction: "verwendung", bucket: "konsum" };
    case "income":
      return { direction: "herkunft", bucket: "einnahmen" };
    case "asset":
      return outflow
        ? { direction: "verwendung", bucket: "vermoegensbildung" }
        : { direction: "herkunft", bucket: "vermoegensaufloesung" };
    case "liability":
      return outflow
        ? { direction: "verwendung", bucket: "tilgung" }
        : { direction: "herkunft", bucket: "kreditaufnahme" };
    default: // equity
      return outflow
        ? { direction: "verwendung", bucket: "eigenkapital" }
        : { direction: "herkunft", bucket: "eigenkapital" };
  }
}

/**
 * Geldflussrechnung über eine wählbare Gruppe liquider Konten L. Aggregiert die Gegen-Postings
 * (Konten außerhalb L) aller Buchungen, die mindestens ein Posting auf L haben — interne
 * Umbuchungen innerhalb L fallen automatisch raus. Zeigt so, wohin die Liquidität fließt
 * (Konsum vs. Vermögensbildung vs. Tilgung), im Gegensatz zur reinen Aufwands-Auswertung.
 */
reportsRouter.get("/money-usage", (req, res) => {
  const { from, to, accounts } = req.query as Record<string, string | undefined>;

  const rootIds = (accounts ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (rootIds.length === 0) {
    return res.json({ netChangeCents: 0, rows: [] });
  }

  const liquidIds = expandSubtrees(rootIds);
  const liquidList = [...liquidIds];
  const liquidPlaceholders = liquidList.map(() => "?").join(",");
  const { clause, params: dateParams } = dateFilter(from, to);

  const rows = db
    .prepare(
      `SELECT po.account_id AS accountId, a.name AS accountName, a.type AS accountType,
              SUM(po.amount_cents) AS total
       FROM postings po
       JOIN accounts a ON a.id = po.account_id
       JOIN transactions t ON t.id = po.transaction_id
       WHERE po.account_id NOT IN (${liquidPlaceholders})
         AND t.id IN (SELECT transaction_id FROM postings WHERE account_id IN (${liquidPlaceholders}))
         ${clause}
       GROUP BY po.account_id`
    )
    .all(...liquidList, ...liquidList, ...dateParams) as {
    accountId: number;
    accountName: string;
    accountType: string;
    total: number;
  }[];

  let netChangeCents = 0;
  const result = rows
    .filter((r) => r.total !== 0)
    .map((r) => {
      const { direction, bucket } = classify(r.accountType, r.total);
      const amountCents = Math.abs(r.total);
      netChangeCents += direction === "herkunft" ? amountCents : -amountCents;
      return {
        accountId: r.accountId,
        accountName: r.accountName,
        accountType: r.accountType,
        direction,
        bucket,
        amountCents,
      };
    });

  res.json({ netChangeCents, rows: result });
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

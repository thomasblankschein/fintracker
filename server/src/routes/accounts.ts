import { Router } from "express";
import { db } from "../db.js";

export const accountsRouter = Router();

interface AccountRow {
  id: number;
  name: string;
  type: string;
  parent_id: number | null;
  is_active: number;
}

function ownBalances(): Map<number, number> {
  const rows = db
    .prepare("SELECT account_id, SUM(amount_cents) AS total FROM postings GROUP BY account_id")
    .all() as { account_id: number; total: number }[];
  return new Map(rows.map((r) => [r.account_id, r.total]));
}

function buildTree(accounts: AccountRow[]) {
  const own = ownBalances();
  const byParent = new Map<number | null, AccountRow[]>();
  for (const a of accounts) {
    const key = a.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  function build(parentId: number | null): any[] {
    const children = byParent.get(parentId) ?? [];
    return children.map((a) => {
      const childNodes = build(a.id);
      const ownBalance = own.get(a.id) ?? 0;
      const balance = ownBalance + childNodes.reduce((sum, c) => sum + c.balance, 0);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        parentId: a.parent_id,
        isActive: !!a.is_active,
        ownBalance,
        balance,
        children: childNodes,
      };
    });
  }

  return build(null);
}

accountsRouter.get("/", (req, res) => {
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY name").all() as AccountRow[];
  res.json(buildTree(accounts));
});

accountsRouter.get("/flat", (req, res) => {
  const accounts = db.prepare("SELECT * FROM accounts WHERE is_active = 1 ORDER BY name").all() as AccountRow[];
  const own = ownBalances();
  res.json(
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      parentId: a.parent_id,
      isActive: !!a.is_active,
      balance: own.get(a.id) ?? 0,
    }))
  );
});

accountsRouter.post("/", (req, res) => {
  const { name, type, parentId } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name ist erforderlich." });
  }
  const validTypes = ["asset", "liability", "equity", "income", "expense"];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: "Ungültiger Kontotyp." });
  }
  const result = db
    .prepare("INSERT INTO accounts (name, type, parent_id) VALUES (?, ?, ?)")
    .run(name.trim(), type, parentId ?? null);
  res.status(201).json({ id: result.lastInsertRowid });
});

accountsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, parentId, isActive } = req.body ?? {};
  const existing = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Konto nicht gefunden." });

  if (name !== undefined) {
    db.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(name, id);
  }
  if (parentId !== undefined) {
    db.prepare("UPDATE accounts SET parent_id = ? WHERE id = ?").run(parentId, id);
  }
  if (isActive !== undefined) {
    db.prepare("UPDATE accounts SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, id);
  }
  res.json({ ok: true });
});

accountsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const postingCount = (
    db.prepare("SELECT COUNT(*) AS c FROM postings WHERE account_id = ?").get(id) as { c: number }
  ).c;
  const childCount = (
    db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE parent_id = ?").get(id) as { c: number }
  ).c;
  if (postingCount > 0 || childCount > 0) {
    return res
      .status(400)
      .json({ error: "Konto hat Buchungen oder Unterkonten und kann nicht gelöscht werden. Stattdessen deaktivieren." });
  }
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  res.json({ ok: true });
});

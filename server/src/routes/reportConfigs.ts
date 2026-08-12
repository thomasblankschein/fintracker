import { Router } from "express";
import { db } from "../db.js";

export const reportConfigsRouter = Router();

function serialize(row: any) {
  return {
    id: row.id,
    name: row.name,
    accountIds: JSON.parse(row.account_ids) as number[],
  };
}

reportConfigsRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM report_account_configs ORDER BY name").all() as any[];
  res.json(rows.map(serialize));
});

reportConfigsRouter.post("/", (req, res) => {
  const { name, accountIds } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name ist erforderlich." });
  }
  if (!Array.isArray(accountIds) || accountIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: "accountIds muss ein Array von Konto-IDs sein." });
  }
  try {
    const result = db
      .prepare("INSERT INTO report_account_configs (name, account_ids) VALUES (?, ?)")
      .run(name.trim(), JSON.stringify(accountIds));
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(400).json({ error: "Eine Konfiguration mit diesem Namen existiert bereits." });
    }
    throw e;
  }
});

reportConfigsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name ist erforderlich." });
  }
  try {
    db.prepare("UPDATE report_account_configs SET name = ? WHERE id = ?").run(name.trim(), id);
    res.json({ ok: true });
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(400).json({ error: "Eine Konfiguration mit diesem Namen existiert bereits." });
    }
    throw e;
  }
});

reportConfigsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM report_account_configs WHERE id = ?").run(id);
  res.json({ ok: true });
});

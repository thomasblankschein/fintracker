import { Router } from "express";
import { db } from "../db.js";

export const importTemplatesRouter = Router();

interface FieldMapping {
  index: number;
  header: string | null;
}

interface TemplateMapping {
  date: FieldMapping;
  amount: FieldMapping;
  description?: FieldMapping;
  payee?: FieldMapping;
}

function serialize(row: any) {
  return {
    id: row.id,
    name: row.name,
    delimiter: row.delimiter,
    hasHeader: !!row.has_header,
    mapping: JSON.parse(row.mapping) as TemplateMapping,
    defaultAccountId: row.default_account_id,
  };
}

importTemplatesRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM import_templates ORDER BY name").all() as any[];
  res.json(rows.map(serialize));
});

importTemplatesRouter.post("/", (req, res) => {
  const { name, delimiter, hasHeader, mapping, defaultAccountId } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name ist erforderlich." });
  }
  if (!delimiter || !mapping || mapping.date === undefined || mapping.amount === undefined) {
    return res.status(400).json({ error: "delimiter und mapping (date, amount) sind erforderlich." });
  }
  try {
    const result = db
      .prepare(
        "INSERT INTO import_templates (name, delimiter, has_header, mapping, default_account_id) VALUES (?, ?, ?, ?, ?)"
      )
      .run(name.trim(), delimiter, hasHeader ? 1 : 0, JSON.stringify(mapping), defaultAccountId ?? null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(400).json({ error: "Eine Vorlage mit diesem Namen existiert bereits." });
    }
    throw e;
  }
});

importTemplatesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM import_templates WHERE id = ?").run(id);
  res.json({ ok: true });
});

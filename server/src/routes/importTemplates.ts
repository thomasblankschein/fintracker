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

type SkipPatternField = "description" | "payee" | "both";

interface SkipPattern {
  pattern: string;
  field: SkipPatternField;
}

const SKIP_PATTERN_FIELDS: SkipPatternField[] = ["description", "payee", "both"];

function validateSkipPatterns(skipPatterns: unknown): string | null {
  if (skipPatterns === undefined) return null;
  if (!Array.isArray(skipPatterns)) return "skipPatterns muss ein Array sein.";
  for (const p of skipPatterns) {
    if (!p || typeof p.pattern !== "string" || !p.pattern.trim()) {
      return "Jedes Suchmuster benötigt einen nicht-leeren Regex-Text.";
    }
    if (!SKIP_PATTERN_FIELDS.includes(p.field)) {
      return `Ungültiges Feld für Suchmuster: ${p.field}`;
    }
    try {
      new RegExp(p.pattern);
    } catch {
      return `Ungültiges Suchmuster (Regex): ${p.pattern}`;
    }
  }
  return null;
}

function serialize(row: any) {
  return {
    id: row.id,
    name: row.name,
    delimiter: row.delimiter,
    hasHeader: !!row.has_header,
    skipRows: row.skip_rows ?? 0,
    mapping: JSON.parse(row.mapping) as TemplateMapping,
    defaultAccountId: row.default_account_id,
    skipPatterns: JSON.parse(row.skip_patterns ?? "[]") as SkipPattern[],
  };
}

importTemplatesRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM import_templates ORDER BY name").all() as any[];
  res.json(rows.map(serialize));
});

importTemplatesRouter.post("/", (req, res) => {
  const { name, delimiter, hasHeader, mapping, defaultAccountId, skipRows, skipPatterns } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name ist erforderlich." });
  }
  if (!delimiter || !mapping || mapping.date === undefined || mapping.amount === undefined) {
    return res.status(400).json({ error: "delimiter und mapping (date, amount) sind erforderlich." });
  }
  const skipPatternsError = validateSkipPatterns(skipPatterns);
  if (skipPatternsError) return res.status(400).json({ error: skipPatternsError });
  try {
    const result = db
      .prepare(
        "INSERT INTO import_templates (name, delimiter, has_header, skip_rows, mapping, default_account_id, skip_patterns) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        name.trim(),
        delimiter,
        hasHeader ? 1 : 0,
        Number(skipRows) || 0,
        JSON.stringify(mapping),
        defaultAccountId ?? null,
        JSON.stringify(skipPatterns ?? [])
      );
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

import { Router } from "express";
import { db, transaction } from "../db.js";
import { nextDueDate, type RecurringTemplateRow } from "../services/forecast.js";

export const recurringRouter = Router();

function serialize(t: any) {
  return {
    id: t.id,
    name: t.name,
    payeeId: t.payee_id,
    payeeName: t.payee_name ?? null,
    fromAccountId: t.from_account_id,
    fromAccountName: t.from_account_name,
    toAccountId: t.to_account_id,
    toAccountName: t.to_account_name,
    amountCents: t.amount_cents,
    interval: t.interval,
    intervalDay: t.interval_day,
    startDate: t.start_date,
    endDate: t.end_date,
    active: !!t.active,
    lastBookedDate: t.last_booked_date,
    nextDueDate: t.active
      ? nextDueDate(t as RecurringTemplateRow, new Date())
      : null,
  };
}

const selectSql = `
  SELECT r.*, p.name AS payee_name,
         fa.name AS from_account_name, ta.name AS to_account_name
  FROM recurring_templates r
  LEFT JOIN payees p ON p.id = r.payee_id
  JOIN accounts fa ON fa.id = r.from_account_id
  JOIN accounts ta ON ta.id = r.to_account_id
`;

recurringRouter.get("/", (req, res) => {
  const rows = db.prepare(`${selectSql} ORDER BY r.name`).all() as any[];
  res.json(rows.map(serialize));
});

recurringRouter.post("/", (req, res) => {
  const {
    name,
    payeeId,
    fromAccountId,
    toAccountId,
    amountCents,
    interval,
    intervalDay,
    startDate,
    endDate,
  } = req.body ?? {};

  if (!name || !fromAccountId || !toAccountId || !amountCents || !interval || !intervalDay || !startDate) {
    return res.status(400).json({ error: "Pflichtfelder fehlen." });
  }
  if (!["weekly", "monthly", "yearly"].includes(interval)) {
    return res.status(400).json({ error: "Ungültiges Intervall." });
  }

  const result = db
    .prepare(
      `INSERT INTO recurring_templates
       (name, payee_id, from_account_id, to_account_id, amount_cents, interval, interval_day, start_date, end_date, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(name, payeeId ?? null, fromAccountId, toAccountId, Math.round(amountCents), interval, intervalDay, startDate, endDate ?? null);
  res.status(201).json({ id: result.lastInsertRowid });
});

recurringRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM recurring_templates WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Vorlage nicht gefunden." });

  const fields = [
    "name",
    "payeeId",
    "fromAccountId",
    "toAccountId",
    "amountCents",
    "interval",
    "intervalDay",
    "startDate",
    "endDate",
    "active",
  ] as const;
  const columnMap: Record<string, string> = {
    name: "name",
    payeeId: "payee_id",
    fromAccountId: "from_account_id",
    toAccountId: "to_account_id",
    amountCents: "amount_cents",
    interval: "interval",
    intervalDay: "interval_day",
    startDate: "start_date",
    endDate: "end_date",
    active: "active",
  };

  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (req.body?.[f] !== undefined) {
      updates.push(`${columnMap[f]} = ?`);
      let v = req.body[f];
      if (f === "active") v = v ? 1 : 0;
      values.push(v);
    }
  }
  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE recurring_templates SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }
  res.json({ ok: true });
});

recurringRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM recurring_templates WHERE id = ?").run(id);
  res.json({ ok: true });
});

recurringRouter.post("/:id/book", (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare("SELECT * FROM recurring_templates WHERE id = ?").get(id) as
    | RecurringTemplateRow
    | undefined;
  if (!t) return res.status(404).json({ error: "Vorlage nicht gefunden." });

  const bookDate = req.body?.date ?? nextDueDate(t, new Date());

  const txId = transaction(() => {
    const txResult = db
      .prepare("INSERT INTO transactions (date, description, payee_id) VALUES (?, ?, ?)")
      .run(bookDate, t.name, t.payee_id);
    const newTxId = Number(txResult.lastInsertRowid);
    db.prepare("INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)").run(
      newTxId,
      t.to_account_id,
      t.amount_cents
    );
    db.prepare("INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)").run(
      newTxId,
      t.from_account_id,
      -t.amount_cents
    );
    db.prepare("UPDATE recurring_templates SET last_booked_date = ? WHERE id = ?").run(bookDate, id);
    return newTxId;
  });

  res.status(201).json({ transactionId: txId });
});

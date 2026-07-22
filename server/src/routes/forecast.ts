import { Router } from "express";
import { db } from "../db.js";
import { expandOccurrences, type RecurringTemplateRow } from "../services/forecast.js";

export const forecastRouter = Router();

forecastRouter.get("/", (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
  const today = new Date();
  const rangeEnd = new Date(today);
  rangeEnd.setMonth(rangeEnd.getMonth() + months);

  const accounts = db
    .prepare(
      `SELECT id, name FROM accounts WHERE type IN ('asset', 'liability') AND is_active = 1 ORDER BY name`
    )
    .all() as { id: number; name: string }[];

  const balanceRows = db
    .prepare("SELECT account_id, SUM(amount_cents) AS total FROM postings GROUP BY account_id")
    .all() as { account_id: number; total: number }[];
  const currentBalances = new Map(balanceRows.map((r) => [r.account_id, r.total]));

  const templates = db
    .prepare("SELECT * FROM recurring_templates WHERE active = 1")
    .all() as unknown as RecurringTemplateRow[];

  const occurrences = expandOccurrences(templates, today, rangeEnd);

  const accountProjections = accounts.map((acc) => {
    let balance = currentBalances.get(acc.id) ?? 0;
    const points: { date: string; balance: number }[] = [
      { date: occurrences[0]?.date ?? today.toISOString().slice(0, 10), balance },
    ];
    for (const occ of occurrences) {
      let delta = 0;
      if (occ.toAccountId === acc.id) delta += occ.amountCents;
      if (occ.fromAccountId === acc.id) delta -= occ.amountCents;
      if (delta !== 0) {
        balance += delta;
        points.push({ date: occ.date, balance });
      }
    }
    return { accountId: acc.id, accountName: acc.name, currentBalance: currentBalances.get(acc.id) ?? 0, projection: points };
  });

  const allAccounts = db.prepare(`SELECT id, name FROM accounts`).all() as { id: number; name: string }[];
  const accountNames = new Map(allAccounts.map((a) => [a.id, a.name]));
  const upcoming = occurrences.slice(0, 50).map((o) => ({
    date: o.date,
    templateId: o.templateId,
    templateName: o.templateName,
    amountCents: o.amountCents,
    fromAccountName: accountNames.get(o.fromAccountId) ?? "?",
    toAccountName: accountNames.get(o.toAccountId) ?? "?",
  }));

  res.json({ months, accounts: accountProjections, upcomingOccurrences: upcoming });
});

import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { db, transaction } from "../db.js";
import { WindowLimiter, generateDeviceToken, normalizeEnrollCode, sha256 } from "./security.js";

export const mobileRouter = Router();

const MAX_AMOUNT_CENTS = 1_000_000; // 10.000,00 €
const MAX_NOTE_LENGTH = 120;
const MAX_AGE_DAYS = 31;
const UNDO_WINDOW_HOURS = 24;

// Fehlversuche pro IP (hinter Pangolin nur sinnvoll mit TRUST_PROXY) und global für die Kopplung:
// der 8-stellige Code ist das schwächste Geheimnis, deshalb dort ein striktes globales Limit.
const authFailures = new WindowLimiter(10, 15 * 60 * 1000);
const enrollFailures = new WindowLimiter(5, 10 * 60 * 1000);
const writesPerDevice = new WindowLimiter(60, 60 * 60 * 1000);

interface Device {
  id: number;
  accountId: number;
  name: string;
}
type DeviceRequest = Request<any> & { device: Device };

function clientKey(req: Request): string {
  return req.ip ?? "unbekannt";
}

function tooMany(res: Response, retryAfter: number): void {
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
}

function requireDevice(req: Request, res: Response, next: NextFunction): void {
  const key = clientKey(req);
  const blocked = authFailures.retryAfterSeconds(key);
  if (blocked > 0) return tooMany(res, blocked);

  const token = req.header("x-device-token");
  const row = token
    ? (db
        .prepare("SELECT id, account_id, name, revoked_at FROM mobile_devices WHERE token_hash = ?")
        .get(sha256(token)) as { id: number; account_id: number; name: string; revoked_at: string | null } | undefined)
    : undefined;

  if (!row || row.revoked_at) {
    authFailures.record(key);
    res.status(401).json({ error: "Gerät nicht (mehr) autorisiert.", code: "device_unauthorized" });
    return;
  }

  // höchstens einmal pro Minute schreiben
  db.prepare(
    "UPDATE mobile_devices SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 minute'))"
  ).run(row.id);

  (req as DeviceRequest).device = { id: row.id, accountId: row.account_id, name: row.name };
  next();
}

/** Heutiges Datum (YYYY-MM-DD) in der Zeitzone des Nutzers. */
function todayBerlin(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Ohne Geheimnis und ohne Datenzugriff: lässt die App prüfen, ob der Server (bzw. ein Proxy davor, z. B. Pangolins
// Basic-Auth) ihre Zugangsdaten akzeptiert, ohne dafür Kopplungsversuche zu verbrauchen.
mobileRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Kopplung

mobileRouter.post("/enroll", (req, res) => {
  const blocked = enrollFailures.retryAfterSeconds("global");
  if (blocked > 0) return tooMany(res, blocked);

  const raw = typeof req.body?.code === "string" ? req.body.code : "";
  const code = normalizeEnrollCode(raw);
  const device =
    code.length === 8
      ? (db
          .prepare(
            `SELECT id FROM mobile_devices
             WHERE enroll_code_hash = ? AND token_hash IS NULL AND revoked_at IS NULL
               AND enroll_expires_at > datetime('now')`
          )
          .get(sha256(code)) as { id: number } | undefined)
      : undefined;

  if (!device) {
    enrollFailures.record("global");
    res.status(400).json({ error: "Kopplungscode ungültig oder abgelaufen." });
    return;
  }

  const token = generateDeviceToken();
  db.prepare(
    "UPDATE mobile_devices SET token_hash = ?, enroll_code_hash = NULL, enroll_expires_at = NULL, last_used_at = datetime('now') WHERE id = ?"
  ).run(sha256(token), device.id);
  res.status(201).json({ token });
});

// ---------------------------------------------------------------- geschützte Routen

mobileRouter.use(requireDevice);

function categoryLabels(): Map<number, string> {
  const all = db.prepare("SELECT id, name, parent_id FROM accounts").all() as {
    id: number;
    name: string;
    parent_id: number | null;
  }[];
  const byId = new Map(all.map((a) => [a.id, a]));
  const labels = new Map<number, string>();
  for (const a of all) {
    const parts: string[] = [];
    let cur: typeof a | undefined = a;
    // Wurzelknoten ("Aufwendungen") gehört nicht in den Pfad
    while (cur && cur.parent_id !== null) {
      parts.unshift(cur.name);
      cur = byId.get(cur.parent_id);
    }
    labels.set(a.id, parts.join(" › "));
  }
  return labels;
}

function recentEntries(deviceId: number) {
  const rows = db
    .prepare(
      `SELECT me.client_id AS clientId, t.date AS date, t.description AS note,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM postings WHERE transaction_id = t.id AND amount_cents > 0) AS amountCents,
              (SELECT a.name FROM postings p JOIN accounts a ON a.id = p.account_id
                 WHERE p.transaction_id = t.id AND p.amount_cents > 0 ORDER BY p.amount_cents DESC LIMIT 1) AS categoryName,
              (me.created_at > datetime('now', '-${UNDO_WINDOW_HOURS} hours')) AS canUndo
       FROM mobile_entries me JOIN transactions t ON t.id = me.transaction_id
       WHERE me.device_id = ? ORDER BY me.id DESC LIMIT 10`
    )
    .all(deviceId) as any[];
  return rows.map((r) => ({ ...r, canUndo: !!r.canUndo }));
}

mobileRouter.get("/bootstrap", (req, res) => {
  const device = (req as DeviceRequest).device;
  const account = db.prepare("SELECT name FROM accounts WHERE id = ?").get(device.accountId) as { name: string };

  const labels = categoryLabels();
  const categories = db
    .prepare("SELECT id, name FROM accounts WHERE type = 'expense' AND is_active = 1 AND parent_id IS NOT NULL")
    .all() as { id: number; name: string }[];

  // Häufigkeit pro Kategorie bei Buchungen auf dem Bargeldkonto dieses Geräts (letzte 90 Tage)
  const usage = new Map(
    (
      db
        .prepare(
          `SELECT po.account_id AS id, COUNT(*) AS uses
           FROM postings po JOIN transactions t ON t.id = po.transaction_id
           WHERE po.amount_cents > 0 AND t.date >= date('now', '-90 days')
             AND po.transaction_id IN (SELECT transaction_id FROM postings WHERE account_id = ?)
           GROUP BY po.account_id`
        )
        .all(device.accountId) as { id: number; uses: number }[]
    ).map((r) => [r.id, r.uses])
  );

  res.json({
    account: { name: account.name },
    deviceName: device.name,
    categories: categories
      .map((c) => ({ id: c.id, name: c.name, path: labels.get(c.id) ?? c.name, uses: usage.get(c.id) ?? 0 }))
      .sort((a, b) => b.uses - a.uses || a.path.localeCompare(b.path, "de")),
    recent: recentEntries(device.id),
  });
});

mobileRouter.get("/entries/recent", (req, res) => {
  res.json(recentEntries((req as DeviceRequest).device.id));
});

mobileRouter.post("/entries", (req, res) => {
  const device = (req as DeviceRequest).device;
  const body = req.body ?? {};

  const retryAfter = writesPerDevice.retryAfterSeconds(String(device.id));
  if (retryAfter > 0) return tooMany(res, retryAfter);
  writesPerDevice.record(String(device.id));

  const { clientId, amountCents, categoryId, date } = body;
  const note = typeof body.note === "string" ? body.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";

  if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
    return res.status(400).json({ error: "clientId ungültig." });
  }
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    return res.status(400).json({ error: "Betrag muss zwischen 0,01 € und 10.000,00 € liegen." });
  }
  if (!Number.isInteger(categoryId)) {
    return res.status(400).json({ error: "Kategorie ungültig." });
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return res.status(400).json({ error: `Notiz darf höchstens ${MAX_NOTE_LENGTH} Zeichen lang sein.` });
  }
  if (typeof date !== "string" || !isRealDate(date)) {
    return res.status(400).json({ error: "Datum ungültig." });
  }
  const today = todayBerlin();
  if (date > shiftDays(today, 1) || date < shiftDays(today, -MAX_AGE_DAYS)) {
    return res.status(400).json({ error: `Datum muss innerhalb der letzten ${MAX_AGE_DAYS} Tage liegen.` });
  }

  const category = db
    .prepare("SELECT id, name FROM accounts WHERE id = ? AND type = 'expense' AND is_active = 1 AND parent_id IS NOT NULL")
    .get(categoryId) as { id: number; name: string } | undefined;
  if (!category) return res.status(400).json({ error: "Kategorie unbekannt oder nicht zulässig." });

  const existing = db
    .prepare("SELECT 1 FROM mobile_entries WHERE device_id = ? AND client_id = ?")
    .get(device.id, clientId);
  if (existing) return res.status(200).json({ ok: true, duplicate: true });

  transaction(() => {
    const tx = db
      .prepare("INSERT INTO transactions (date, description, payee_id) VALUES (?, ?, NULL)")
      .run(date, note || null);
    const txId = Number(tx.lastInsertRowid);
    // Aufwandskonto +, Bargeldkonto des Geräts − (der Client bestimmt nie das Konto)
    db.prepare("INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)").run(
      txId,
      category.id,
      amountCents
    );
    db.prepare("INSERT INTO postings (transaction_id, account_id, amount_cents) VALUES (?, ?, ?)").run(
      txId,
      device.accountId,
      -amountCents
    );
    db.prepare("INSERT INTO mobile_entries (device_id, transaction_id, client_id) VALUES (?, ?, ?)").run(
      device.id,
      txId,
      clientId
    );
  });

  res.status(201).json({ ok: true, duplicate: false });
});

mobileRouter.delete("/entries/:clientId", (req, res) => {
  const device = (req as DeviceRequest).device;
  const entry = db
    .prepare(
      `SELECT transaction_id AS transactionId,
              (created_at > datetime('now', '-${UNDO_WINDOW_HOURS} hours')) AS withinWindow
       FROM mobile_entries WHERE device_id = ? AND client_id = ?`
    )
    .get(device.id, req.params.clientId) as { transactionId: number; withinWindow: number } | undefined;

  if (!entry) return res.status(404).json({ error: "Eintrag nicht gefunden." });
  if (!entry.withinWindow) {
    return res.status(403).json({ error: `Rückgängig nur innerhalb von ${UNDO_WINDOW_HOURS} Stunden möglich.` });
  }
  // Postings und der mobile_entries-Eintrag werden per ON DELETE CASCADE mitgelöscht
  db.prepare("DELETE FROM transactions WHERE id = ?").run(entry.transactionId);
  res.json({ ok: true });
});

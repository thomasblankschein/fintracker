import { Router } from "express";
import { db } from "../db.js";
import { formatEnrollCode, generateEnrollCode, sha256 } from "../mobile/security.js";

export const mobileDevicesRouter = Router();

const ENROLL_VALID_MINUTES = 10;

mobileDevicesRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT d.id, d.name, d.account_id, a.name AS account_name, d.created_at, d.last_used_at, d.revoked_at,
              d.token_hash IS NOT NULL AS enrolled,
              (d.token_hash IS NULL AND d.revoked_at IS NULL AND d.enroll_expires_at > datetime('now')) AS pending,
              d.enroll_expires_at,
              (SELECT COUNT(*) FROM mobile_entries e WHERE e.device_id = d.id) AS entry_count
       FROM mobile_devices d JOIN accounts a ON a.id = d.account_id ORDER BY d.id DESC`
    )
    .all() as any[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountId: r.account_id,
      accountName: r.account_name,
      status: r.revoked_at ? "revoked" : r.enrolled ? "active" : r.pending ? "pending" : "expired",
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      enrollExpiresAt: r.pending ? r.enroll_expires_at : null,
      entryCount: r.entry_count,
    }))
  );
});

mobileDevicesRouter.post("/", (req, res) => {
  const { name, accountId } = req.body ?? {};
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 60) {
    return res.status(400).json({ error: "Name ist erforderlich (höchstens 60 Zeichen)." });
  }
  const account = db
    .prepare("SELECT id FROM accounts WHERE id = ? AND type = 'asset' AND is_active = 1")
    .get(accountId) as { id: number } | undefined;
  if (!account) return res.status(400).json({ error: "Bitte ein aktives Aktiva-Konto (z. B. Bargeld) wählen." });

  const code = generateEnrollCode();
  const result = db
    .prepare(
      `INSERT INTO mobile_devices (name, account_id, enroll_code_hash, enroll_expires_at)
       VALUES (?, ?, ?, datetime('now', '+${ENROLL_VALID_MINUTES} minutes'))`
    )
    .run(trimmed, account.id, sha256(code));
  const row = db
    .prepare("SELECT enroll_expires_at AS expires FROM mobile_devices WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as { expires: string };
  // Der Klartext-Code wird nur hier einmalig zurückgegeben; gespeichert ist nur sein Hash.
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    code: formatEnrollCode(code),
    expiresAt: row.expires,
    validMinutes: ENROLL_VALID_MINUTES,
  });
});

// Widerruf: Token und Kopplungscode werden unbrauchbar, die erfassten Buchungen bleiben unberührt.
// Mit ?remove=1 wird ein bereits widerrufenes Gerät samt Audit-Verknüpfung (nicht der Buchungen) entfernt.
mobileDevicesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const device = db.prepare("SELECT revoked_at FROM mobile_devices WHERE id = ?").get(id) as
    | { revoked_at: string | null }
    | undefined;
  if (!device) return res.status(404).json({ error: "Gerät nicht gefunden." });

  if (req.query.remove === "1") {
    if (!device.revoked_at) return res.status(400).json({ error: "Gerät zuerst widerrufen." });
    db.prepare("DELETE FROM mobile_devices WHERE id = ?").run(id);
    return res.json({ ok: true });
  }
  db.prepare(
    "UPDATE mobile_devices SET revoked_at = datetime('now'), token_hash = NULL, enroll_code_hash = NULL, enroll_expires_at = NULL WHERE id = ? AND revoked_at IS NULL"
  ).run(id);
  res.json({ ok: true });
});

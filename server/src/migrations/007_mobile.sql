CREATE TABLE IF NOT EXISTS mobile_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  token_hash TEXT UNIQUE,
  enroll_code_hash TEXT,
  enroll_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS mobile_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (device_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_entries_device ON mobile_entries(device_id, id);

CREATE TABLE IF NOT EXISTS import_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_exclusions_lookup ON import_exclusions(account_id, date, amount_cents);

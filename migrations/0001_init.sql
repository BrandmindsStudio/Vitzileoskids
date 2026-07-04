-- Vitzileos Kids — Z-Report dashboard: initial schema

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session id is the SHA-256 hex of the cookie token; the raw token is never stored.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Login rate limiting: one row per failed attempt.
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL, -- email or ip
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts ON login_attempts(identifier, attempted_at);

CREATE TABLE z_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,          -- YYYY-MM-DD, Europe/Athens
  z_time TEXT,                          -- "HH:MM"
  -- NULL while a photo upload is still a draft awaiting extraction/review;
  -- required (enforced in the API) before a report can be confirmed.
  z_number INTEGER,
  gross_total REAL NOT NULL DEFAULT 0,
  receipt_count INTEGER NOT NULL DEFAULT 0,
  cash_total REAL,
  card_total REAL,
  discounts_total REAL,
  cancelled_total REAL,
  cancelled_count INTEGER,
  register_serial TEXT,
  aade_transmitted INTEGER,             -- 1 / 0 / NULL
  source TEXT NOT NULL CHECK (source IN ('photo','manual','mydata')),
  status TEXT NOT NULL CHECK (status IN ('pending_review','confirmed')),
  extraction_json TEXT,
  notes TEXT,
  deleted_at TEXT,                      -- soft delete
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Uniqueness applies to live rows only, so a soft-deleted report can be re-entered.
-- NULL z_number rows (drafts) never collide: SQLite treats NULLs as distinct in unique indexes.
CREATE UNIQUE INDEX idx_z_reports_unique ON z_reports(business_date, z_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_z_reports_date ON z_reports(business_date);

CREATE TABLE z_report_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  z_report_id INTEGER NOT NULL REFERENCES z_reports(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_photos_report ON z_report_photos(z_report_id);

CREATE TABLE z_report_vat_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  z_report_id INTEGER NOT NULL REFERENCES z_reports(id) ON DELETE CASCADE,
  vat_label TEXT NOT NULL,              -- e.g. "Γ"
  vat_rate REAL NOT NULL,               -- e.g. 24
  gross_amount REAL,
  net_amount REAL,
  vat_amount REAL
);
CREATE INDEX idx_vat_report ON z_report_vat_lines(z_report_id);

CREATE TABLE z_report_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  z_report_id INTEGER NOT NULL REFERENCES z_reports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- e.g. "ΕΝΔΥΣΗ"
  amount REAL,
  items REAL
);
CREATE INDEX idx_dept_report ON z_report_departments(z_report_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Closed weekdays as JSON array of JS day numbers (0 = Sunday). Default: Sundays closed.
INSERT INTO settings (key, value) VALUES ('closed_weekdays', '[0]');

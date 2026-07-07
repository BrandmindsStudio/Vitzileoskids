-- Vitzileos Kids — Phase 2: inventory + POS
-- Products/variants mirror the WooCommerce catalog (woo_* ids) but also allow
-- purely local rows (woo ids NULL). Sales carry fiscal_* columns that stay
-- 'none'/NULL while the 3i register issues receipts; a licensed e-invoicing
-- provider (ΥΠΑΗΕΣ) integration can later fill them without schema changes.

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  woo_id INTEGER,                        -- WooCommerce product id (NULL for local-only)
  mpn TEXT,                              -- supplier style code, e.g. "45-2007"
  name TEXT NOT NULL,
  category TEXT,
  manufacturer TEXT,
  color TEXT,
  image_url TEXT,
  link TEXT,
  description TEXT,
  vat_rate REAL NOT NULL DEFAULT 24,
  -- lower-cased name+mpn+manufacturer, maintained by the API for Greek-insensitive search
  search_text TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_products_woo ON products(woo_id) WHERE woo_id IS NOT NULL;
CREATE INDEX idx_products_search ON products(search_text);
CREATE INDEX idx_products_mpn ON products(mpn);

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  woo_variation_id INTEGER,              -- WooCommerce variation id (NULL for local-only)
  ean TEXT,                              -- barcode; mostly taught at the counter over time
  size TEXT,
  color TEXT,
  price REAL NOT NULL DEFAULT 0,         -- retail price incl. VAT
  stock INTEGER NOT NULL DEFAULT 0,      -- may go negative; the sale is never blocked
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_variants_woo ON product_variants(woo_variation_id) WHERE woo_variation_id IS NOT NULL;
CREATE UNIQUE INDEX idx_variants_ean ON product_variants(ean) WHERE ean IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('sale','return')),
  business_date TEXT NOT NULL,           -- YYYY-MM-DD, Europe/Athens
  channel TEXT NOT NULL DEFAULT 'local' CHECK (channel IN ('local','eshop')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card')),
  total REAL NOT NULL,                   -- positive for both types; type says direction
  notes TEXT,
  -- fiscal integration (unused while the 3i register issues receipts)
  fiscal_status TEXT NOT NULL DEFAULT 'none' CHECK (fiscal_status IN ('none','pending','issued','failed')),
  fiscal_provider TEXT,
  fiscal_mark TEXT,                      -- myDATA MARK
  fiscal_uid TEXT,
  receipt_url TEXT,
  voided_at TEXT,                        -- void = soft cancel + stock reversal
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sales_date ON sales(business_date);

CREATE TABLE sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id),
  -- snapshots so history survives product edits/deletes
  product_name TEXT NOT NULL,
  variant_label TEXT,                    -- e.g. "6Y · Μπλε"
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total REAL NOT NULL
);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);

-- Full audit of every stock change (sales, returns, voids, manual corrections).
-- Bulk XML imports set stock directly and are recorded in product_imports instead.
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale','return','void','manual')),
  sale_id INTEGER REFERENCES sales(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_movements_variant ON stock_movements(variant_id);

CREATE TABLE product_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT,
  update_stock INTEGER NOT NULL DEFAULT 1,
  products_upserted INTEGER NOT NULL DEFAULT 0,
  variants_upserted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

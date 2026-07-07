-- Product image galleries + feed sync status.

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_product ON product_images(product_id);

-- Existing single thumbnails become the first gallery image until the next import.
INSERT INTO product_images (product_id, url, order_index)
SELECT id, image_url, 0 FROM products WHERE image_url IS NOT NULL AND deleted_at IS NULL;

-- Where an import came from and what the feed said about itself.
ALTER TABLE product_imports ADD COLUMN source TEXT NOT NULL DEFAULT 'file'; -- 'file' | 'url'
ALTER TABLE product_imports ADD COLUMN feed_created_at TEXT;               -- <created_at> inside the feed

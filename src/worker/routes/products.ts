import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../env";
import type { LookupResult, Product, ProductDetail } from "../../shared/types";

export const products = new Hono<AppContext>();

// ---------- validation ----------

const ImportVariantSchema = z.object({
  woo_variation_id: z.number().int().nullable(),
  ean: z.string().max(64).nullable(),
  size: z.string().max(60).nullable(),
  color: z.string().max(120).nullable(),
  price: z.number().finite().min(0),
  stock: z.number().int(),
});

const ImportProductSchema = z.object({
  woo_id: z.number().int(),
  mpn: z.string().max(120).nullable(),
  name: z.string().min(1).max(300),
  category: z.string().max(300).nullable(),
  manufacturer: z.string().max(200).nullable(),
  color: z.string().max(120).nullable(),
  image_url: z.string().max(1000).nullable(),
  images: z.array(z.string().max(1000)).max(12).default([]),
  link: z.string().max(1000).nullable(),
  description: z.string().max(4000).nullable(),
  vat_rate: z.number().finite().min(0).max(50),
  variants: z.array(ImportVariantSchema).min(1).max(100),
});

const ImportBatchSchema = z.object({
  update_stock: z.boolean(),
  import_id: z.number().int().nullable(), // first batch: null → server creates the audit row
  filename: z.string().max(300).nullable(),
  source: z.enum(["file", "url"]).default("file"),
  feed_created_at: z.string().max(40).nullable().default(null),
  products: z.array(ImportProductSchema).min(1).max(60),
});

const ManualProductSchema = z.object({
  mpn: z.string().max(120).nullable(),
  name: z.string().min(1).max(300),
  category: z.string().max(300).nullable(),
  manufacturer: z.string().max(200).nullable(),
  color: z.string().max(120).nullable(),
  vat_rate: z.number().finite().min(0).max(50),
  variants: z.array(ImportVariantSchema.omit({ woo_variation_id: true })).min(1).max(50),
});

const VariantUpdateSchema = z.object({
  size: z.string().max(60).nullable().optional(),
  color: z.string().max(120).nullable().optional(),
  price: z.number().finite().min(0).optional(),
});

function searchText(p: { name: string; mpn: string | null; manufacturer: string | null }): string {
  return [p.name, p.mpn, p.manufacturer].filter(Boolean).join(" ").toLowerCase();
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

// ---------- bulk import (client parses the e-shop XML, posts JSON chunks) ----------

products.post("/import", async (c) => {
  const parsed = ImportBatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  const { update_stock, products: items, filename, source, feed_created_at } = parsed.data;
  let importId = parsed.data.import_id;
  const db = c.env.DB;
  const user = c.get("user");

  if (importId == null) {
    const row = await db
      .prepare("INSERT INTO product_imports (filename, update_stock, source, feed_created_at, created_by) VALUES (?,?,?,?,?) RETURNING id")
      .bind(filename, update_stock ? 1 : 0, source, feed_created_at, user.id)
      .first<{ id: number }>();
    importId = row!.id;
  }

  // Phase 1: upsert products by woo_id, collecting ids via RETURNING.
  const productStmts = items.map((p) =>
    db
      .prepare(
        `INSERT INTO products (woo_id, mpn, name, category, manufacturer, color, image_url, link, description, vat_rate, search_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(woo_id) WHERE woo_id IS NOT NULL DO UPDATE SET
           mpn=excluded.mpn, name=excluded.name, category=excluded.category,
           manufacturer=excluded.manufacturer, color=excluded.color, image_url=excluded.image_url,
           link=excluded.link, description=excluded.description, vat_rate=excluded.vat_rate,
           search_text=excluded.search_text, deleted_at=NULL, updated_at=datetime('now')
         RETURNING id`,
      )
      .bind(
        p.woo_id, p.mpn, p.name, p.category, p.manufacturer, p.color,
        p.image_url, p.link, p.description, p.vat_rate, searchText(p),
      ),
  );
  const productResults = await db.batch<{ id: number }>(productStmts);

  // Phase 2: upsert variants by woo_variation_id. A locally-taught EAN is never
  // overwritten by a NULL from the feed; stock only moves when update_stock is on.
  // Image galleries are replaced wholesale from the feed.
  const stockClause = update_stock ? "stock=excluded.stock," : "";
  const variantStmts: D1PreparedStatement[] = [];
  let variantCount = 0;
  items.forEach((p, i) => {
    const productId = productResults[i].results[0].id;
    variantStmts.push(db.prepare("DELETE FROM product_images WHERE product_id = ?").bind(productId));
    p.images.forEach((url, j) => {
      variantStmts.push(
        db.prepare("INSERT INTO product_images (product_id, url, order_index) VALUES (?,?,?)").bind(productId, url, j),
      );
    });
    for (const v of p.variants) {
      variantCount++;
      variantStmts.push(
        db
          .prepare(
            `INSERT INTO product_variants (product_id, woo_variation_id, ean, size, color, price, stock)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(woo_variation_id) WHERE woo_variation_id IS NOT NULL DO UPDATE SET
               product_id=excluded.product_id,
               ean=COALESCE(excluded.ean, product_variants.ean),
               size=excluded.size, color=excluded.color, price=excluded.price,
               ${stockClause} deleted_at=NULL, updated_at=datetime('now')`,
          )
          .bind(productId, v.woo_variation_id, v.ean, v.size, v.color, v.price, update_stock ? v.stock : 0),
      );
    }
  });
  if (variantStmts.length > 0) await db.batch(variantStmts);

  await db
    .prepare(
      "UPDATE product_imports SET products_upserted = products_upserted + ?, variants_upserted = variants_upserted + ? WHERE id = ?",
    )
    .bind(items.length, variantCount, importId)
    .run();

  return c.json({ ok: true, import_id: importId, products: items.length, variants: variantCount });
});

// ---------- POS barcode lookup ----------

products.get("/lookup", async (c) => {
  const code = (c.req.query("code") ?? "").trim();
  if (!code) return c.json({ error: "missing_code" }, 400);

  const byEan = await c.env.DB
    .prepare(
      `SELECT v.id, v.product_id, v.woo_variation_id, v.ean, v.size, v.color, v.price, v.stock,
              p.name, p.mpn, p.manufacturer, p.image_url, p.vat_rate
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.ean = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL`,
    )
    .bind(code)
    .first<Record<string, never>>();

  if (byEan) {
    const r = byEan as Record<string, unknown>;
    const result: LookupResult = {
      variant: {
        id: r.id as number, product_id: r.product_id as number,
        woo_variation_id: r.woo_variation_id as number | null, ean: r.ean as string | null,
        size: r.size as string | null, color: r.color as string | null,
        price: r.price as number, stock: r.stock as number,
      },
      product: {
        id: r.product_id as number, name: r.name as string, mpn: r.mpn as string | null,
        manufacturer: r.manufacturer as string | null, image_url: r.image_url as string | null,
        vat_rate: r.vat_rate as number,
      },
    };
    return c.json({ match: result });
  }

  // Some tags carry the supplier code instead of an EAN — offer those products for teach-mode.
  const byMpn = await c.env.DB
    .prepare("SELECT id FROM products WHERE mpn = ? AND deleted_at IS NULL LIMIT 5")
    .bind(code)
    .all<{ id: number }>();
  return c.json({ match: null, mpn_product_ids: byMpn.results.map((r) => r.id) });
});

// ---------- teach mode: assign a scanned EAN to a variant ----------

products.post("/variants/:id/ean", async (c) => {
  const id = Number(c.req.param("id"));
  const body = z.object({ ean: z.string().min(4).max(64) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  try {
    const res = await c.env.DB
      .prepare("UPDATE product_variants SET ean = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
      .bind(body.data.ean.trim(), id)
      .run();
    if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  } catch (e) {
    if (isUniqueError(e)) return c.json({ error: "ean_taken" }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

// ---------- variant edits (price/size/color) and manual stock corrections ----------

products.put("/variants/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = VariantUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const u = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (u.size !== undefined) { sets.push("size = ?"); binds.push(u.size); }
  if (u.color !== undefined) { sets.push("color = ?"); binds.push(u.color); }
  if (u.price !== undefined) { sets.push("price = ?"); binds.push(u.price); }
  if (sets.length === 0) return c.json({ error: "empty_update" }, 400);
  const res = await c.env.DB
    .prepare(`UPDATE product_variants SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`)
    .bind(...binds, id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

products.post("/variants/:id/stock", async (c) => {
  const id = Number(c.req.param("id"));
  const body = z.object({ set_to: z.number().int().min(-999).max(99999) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  const user = c.get("user");
  const current = await c.env.DB
    .prepare("SELECT stock FROM product_variants WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<{ stock: number }>();
  if (!current) return c.json({ error: "not_found" }, 404);
  const delta = body.data.set_to - current.stock;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE product_variants SET stock = ?, updated_at = datetime('now') WHERE id = ?").bind(body.data.set_to, id),
    c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, created_by) VALUES (?,?,'manual',?)").bind(id, delta, user.id),
  ]);
  return c.json({ ok: true, stock: body.data.set_to });
});

// ---------- manual product creation ----------

products.post("/", async (c) => {
  const parsed = ManualProductSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  const p = parsed.data;
  const row = await c.env.DB
    .prepare(
      "INSERT INTO products (mpn, name, category, manufacturer, color, vat_rate, search_text) VALUES (?,?,?,?,?,?,?) RETURNING id",
    )
    .bind(p.mpn, p.name, p.category, p.manufacturer, p.color, p.vat_rate, searchText(p))
    .first<{ id: number }>();
  const productId = row!.id;
  try {
    await c.env.DB.batch(
      p.variants.map((v) =>
        c.env.DB
          .prepare("INSERT INTO product_variants (product_id, ean, size, color, price, stock) VALUES (?,?,?,?,?,?)")
          .bind(productId, v.ean, v.size, v.color, v.price, v.stock),
      ),
    );
  } catch (e) {
    if (isUniqueError(e)) {
      await c.env.DB.prepare("DELETE FROM products WHERE id = ?").bind(productId).run();
      return c.json({ error: "ean_taken" }, 409);
    }
    throw e;
  }
  return c.json({ id: productId }, 201);
});

// ---------- feed sync: status, configured URL, and a CORS-free proxy ----------

products.get("/feed-status", async (c) => {
  const db = c.env.DB;
  const [urlRow, lastImport, totals] = await Promise.all([
    db.prepare("SELECT value FROM settings WHERE key = 'feed_url'").first<{ value: string }>(),
    db.prepare(
      "SELECT created_at, source, filename, feed_created_at, products_upserted, variants_upserted FROM product_imports ORDER BY id DESC LIMIT 1",
    ).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) AS products,
         (SELECT COUNT(*) FROM product_variants WHERE deleted_at IS NULL) AS variants,
         (SELECT COUNT(*) FROM product_variants WHERE deleted_at IS NULL AND ean IS NOT NULL) AS with_ean`,
    ).first<{ products: number; variants: number; with_ean: number }>(),
  ]);
  return c.json({
    feed_url: urlRow?.value || null,
    last_import: lastImport ?? null,
    totals: totals ?? { products: 0, variants: 0, with_ean: 0 },
  });
});

products.put("/feed-url", async (c) => {
  const body = z.object({ url: z.string().max(1000) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  const url = body.data.url.trim();
  if (url && !/^https:\/\//.test(url)) return c.json({ error: "https_required" }, 400);
  await c.env.DB
    .prepare("INSERT INTO settings (key, value) VALUES ('feed_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(url)
    .run();
  return c.json({ ok: true });
});

// The SPA can't fetch the e-shop feed directly (CORS), so the Worker relays it.
products.get("/feed-proxy", async (c) => {
  const urlRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'feed_url'").first<{ value: string }>();
  if (!urlRow?.value) return c.json({ error: "no_feed_url" }, 400);
  try {
    const upstream = await fetch(urlRow.value, {
      headers: { "User-Agent": "VitzileosPOS/1.0 (+https://vitzileospos.com)", Accept: "application/xml,text/xml,*/*" },
    });
    if (!upstream.ok) {
      console.error("feed_fetch_failed", upstream.status);
      return c.json({ error: "feed_fetch_failed", status: upstream.status }, 502);
    }
    return new Response(upstream.body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
  } catch (e) {
    console.error("feed_fetch_error", e instanceof Error ? e.message : e);
    return c.json({ error: "feed_unreachable" }, 502);
  }
});

// ---------- list / filters / detail ----------

products.get("/meta", async (c) => {
  const [cats, mans] = await Promise.all([
    c.env.DB.prepare("SELECT DISTINCT category FROM products WHERE deleted_at IS NULL AND category IS NOT NULL ORDER BY category").all<{ category: string }>(),
    c.env.DB.prepare("SELECT DISTINCT manufacturer FROM products WHERE deleted_at IS NULL AND manufacturer IS NOT NULL ORDER BY manufacturer").all<{ manufacturer: string }>(),
  ]);
  return c.json({
    categories: cats.results.map((r) => r.category),
    manufacturers: mans.results.map((r) => r.manufacturer),
  });
});

products.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const category = c.req.query("category");
  const manufacturer = c.req.query("manufacturer");
  const inStock = c.req.query("in_stock") === "1";
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  const limit = 50;

  let where = "p.deleted_at IS NULL";
  const binds: unknown[] = [];
  if (q) {
    where += " AND (p.search_text LIKE ? OR EXISTS (SELECT 1 FROM product_variants ve WHERE ve.product_id = p.id AND ve.ean = ?))";
    binds.push(`%${q}%`, q);
  }
  if (category) { where += " AND p.category = ?"; binds.push(category); }
  if (manufacturer) { where += " AND p.manufacturer = ?"; binds.push(manufacturer); }

  const having = inStock ? "HAVING COALESCE(SUM(v.stock), 0) > 0" : "";
  const rows = await c.env.DB
    .prepare(
      `SELECT p.id, p.woo_id, p.mpn, p.name, p.category, p.manufacturer, p.color, p.image_url, p.vat_rate,
              COALESCE(SUM(v.stock), 0) AS total_stock,
              COUNT(v.id) AS variant_count,
              MIN(v.price) AS min_price, MAX(v.price) AS max_price
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL
       WHERE ${where}
       GROUP BY p.id ${having}
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT ${limit + 1} OFFSET ?`,
    )
    .bind(...binds, offset)
    .all<Product>();

  const page = rows.results.slice(0, limit);
  return c.json({ products: page, has_more: rows.results.length > limit, offset });
});

products.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const product = await c.env.DB
    .prepare("SELECT id, woo_id, mpn, name, category, manufacturer, color, image_url, link, description, vat_rate FROM products WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!product) return c.json({ error: "not_found" }, 404);
  const [variants, images] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, product_id, woo_variation_id, ean, size, color, price, stock FROM product_variants WHERE product_id = ? AND deleted_at IS NULL ORDER BY size, id",
    ).bind(id).all(),
    c.env.DB.prepare("SELECT url FROM product_images WHERE product_id = ? ORDER BY order_index").bind(id).all<{ url: string }>(),
  ]);
  return c.json({
    ...product,
    variants: variants.results,
    images: images.results.map((r) => r.url),
  } as unknown as ProductDetail);
});

products.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").bind(id),
    c.env.DB.prepare("UPDATE product_variants SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE product_id = ? AND deleted_at IS NULL").bind(id),
  ]);
  return c.json({ ok: true });
});

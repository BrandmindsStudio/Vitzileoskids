import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../env";
import { athensToday, addDays } from "../dates";
import type { ReconRow, Sale, SalesDay } from "../../shared/types";

export const sales = new Hono<AppContext>();

const SaleLineSchema = z.object({
  variant_id: z.number().int(),
  quantity: z.number().int().min(1).max(200),
  // Price can differ from the catalog (counter discounts); validated non-negative.
  unit_price: z.number().finite().min(0),
});

const SaleInputSchema = z.object({
  type: z.enum(["sale", "return"]),
  payment_method: z.enum(["cash", "card"]),
  notes: z.string().max(1000).nullable(),
  lines: z.array(SaleLineSchema).min(1).max(100),
});

async function loadSale(db: D1Database, id: number): Promise<Sale | null> {
  const sale = await db.prepare("SELECT * FROM sales WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!sale) return null;
  const lines = await db
    .prepare("SELECT id, variant_id, product_name, variant_label, unit_price, quantity, line_total FROM sale_lines WHERE sale_id = ? ORDER BY id")
    .bind(id)
    .all();
  return { ...(sale as object), lines: lines.results } as unknown as Sale;
}

// ---------- create sale / return: stock moves atomically with the record ----------

sales.post("/", async (c) => {
  const parsed = SaleInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");

  // Load the referenced variants for snapshots; a sale of an unknown variant is rejected.
  const ids = [...new Set(input.lines.map((l) => l.variant_id))];
  const placeholders = ids.map(() => "?").join(",");
  const variantRows = await db
    .prepare(
      `SELECT v.id, v.size, v.color, p.name, p.color AS product_color
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id IN (${placeholders}) AND v.deleted_at IS NULL`,
    )
    .bind(...ids)
    .all<{ id: number; size: string | null; color: string | null; name: string; product_color: string | null }>();
  const byId = new Map(variantRows.results.map((v) => [v.id, v]));
  if (byId.size !== ids.length) return c.json({ error: "unknown_variant" }, 400);

  const total = input.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const sale = await db
    .prepare(
      "INSERT INTO sales (type, business_date, channel, payment_method, total, notes, created_by) VALUES (?,?,'local',?,?,?,?) RETURNING id",
    )
    .bind(input.type, athensToday(), input.payment_method, Math.round(total * 100) / 100, input.notes, user.id)
    .first<{ id: number }>();
  const saleId = sale!.id;

  // Sales remove stock, returns bring it back.
  const direction = input.type === "sale" ? -1 : 1;
  const stmts: D1PreparedStatement[] = [];
  for (const l of input.lines) {
    const v = byId.get(l.variant_id)!;
    const label = [v.size, v.color ?? v.product_color].filter(Boolean).join(" · ") || null;
    stmts.push(
      db.prepare(
        "INSERT INTO sale_lines (sale_id, variant_id, product_name, variant_label, unit_price, quantity, line_total) VALUES (?,?,?,?,?,?,?)",
      ).bind(saleId, l.variant_id, v.name, label, l.unit_price, l.quantity, Math.round(l.unit_price * l.quantity * 100) / 100),
      db.prepare("UPDATE product_variants SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?")
        .bind(direction * l.quantity, l.variant_id),
      db.prepare("INSERT INTO stock_movements (variant_id, delta, reason, sale_id, created_by) VALUES (?,?,?,?,?)")
        .bind(l.variant_id, direction * l.quantity, input.type, saleId, user.id),
    );
  }
  await db.batch(stmts);
  return c.json(await loadSale(db, saleId), 201);
});

// ---------- void: soft cancel + reverse the stock ----------

sales.post("/:id/void", async (c) => {
  const id = Number(c.req.param("id"));
  const db = c.env.DB;
  const user = c.get("user");
  const sale = await db
    .prepare("SELECT id, type, voided_at FROM sales WHERE id = ?")
    .bind(id)
    .first<{ id: number; type: string; voided_at: string | null }>();
  if (!sale) return c.json({ error: "not_found" }, 404);
  if (sale.voided_at) return c.json({ error: "already_voided" }, 409);

  const lines = await db
    .prepare("SELECT variant_id, quantity FROM sale_lines WHERE sale_id = ? AND variant_id IS NOT NULL")
    .bind(id)
    .all<{ variant_id: number; quantity: number }>();

  // A voided sale puts stock back; a voided return takes it out again.
  const direction = sale.type === "sale" ? 1 : -1;
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE sales SET voided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(id),
  ];
  for (const l of lines.results) {
    stmts.push(
      db.prepare("UPDATE product_variants SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?")
        .bind(direction * l.quantity, l.variant_id),
      db.prepare("INSERT INTO stock_movements (variant_id, delta, reason, sale_id, created_by) VALUES (?,?,'void',?,?)")
        .bind(l.variant_id, direction * l.quantity, id, user.id),
    );
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

// ---------- daily list + totals (the number to reconcile against the Z) ----------

sales.get("/", async (c) => {
  const date = c.req.query("date") ?? athensToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "invalid_date" }, 400);
  const db = c.env.DB;

  const [rows, lineRows] = await Promise.all([
    db.prepare("SELECT * FROM sales WHERE business_date = ? ORDER BY id DESC LIMIT 300").bind(date).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT l.id, l.sale_id, l.variant_id, l.product_name, l.variant_label, l.unit_price, l.quantity, l.line_total
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE s.business_date = ? ORDER BY l.id`,
    ).bind(date).all<Record<string, unknown>>(),
  ]);
  const linesBySale = new Map<number, unknown[]>();
  for (const l of lineRows.results) {
    const key = l.sale_id as number;
    if (!linesBySale.has(key)) linesBySale.set(key, []);
    linesBySale.get(key)!.push(l);
  }
  const list = rows.results.map(
    (s) => ({ ...s, lines: linesBySale.get(s.id as number) ?? [] }) as unknown as Sale,
  );

  const active = list.filter((s) => !s.voided_at);
  const saleSum = active.filter((s) => s.type === "sale").reduce((sum, s) => sum + s.total, 0);
  const returnSum = active.filter((s) => s.type === "return").reduce((sum, s) => sum + s.total, 0);
  const net = (m: "cash" | "card") =>
    active.filter((s) => s.payment_method === m).reduce((sum, s) => sum + (s.type === "sale" ? s.total : -s.total), 0);

  const day: SalesDay = {
    date,
    sales: list,
    totals: {
      count: active.filter((s) => s.type === "sale").length,
      total: Math.round((saleSum - returnSum) * 100) / 100,
      cash: Math.round(net("cash") * 100) / 100,
      card: Math.round(net("card") * 100) / 100,
      returns_total: Math.round(returnSum * 100) / 100,
    },
  };
  return c.json(day);
});

// ---------- Z ↔ POS reconciliation ----------
// Compares the register's confirmed Z-reports against POS-recorded sales per day.
// Same ±0.05 € tolerance as the extraction cross-checks.

const RECON_TOLERANCE = 0.05;

sales.get("/reconciliation", async (c) => {
  const db = c.env.DB;
  const single = c.req.query("date");
  let start: string;
  let end: string;
  if (single && /^\d{4}-\d{2}-\d{2}$/.test(single)) {
    start = end = single;
  } else {
    const days = Math.min(60, Math.max(1, Number(c.req.query("days") ?? 14) || 14));
    end = athensToday();
    start = addDays(end, -(days - 1));
  }

  const [zRows, posRows] = await Promise.all([
    db.prepare(
      `SELECT business_date AS d, SUM(gross_total) AS gross,
              SUM(COALESCE(cash_total, 0)) AS cash, SUM(COALESCE(card_total, 0)) AS card
       FROM z_reports
       WHERE status = 'confirmed' AND deleted_at IS NULL AND business_date BETWEEN ? AND ?
       GROUP BY business_date`,
    ).bind(start, end).all<{ d: string; gross: number; cash: number; card: number }>(),
    db.prepare(
      `SELECT business_date AS d,
              SUM(CASE WHEN type = 'sale' THEN total ELSE -total END) AS total,
              SUM(CASE WHEN payment_method = 'cash' THEN (CASE WHEN type = 'sale' THEN total ELSE -total END) ELSE 0 END) AS cash,
              SUM(CASE WHEN payment_method = 'card' THEN (CASE WHEN type = 'sale' THEN total ELSE -total END) ELSE 0 END) AS card,
              COUNT(*) AS tx
       FROM sales
       WHERE voided_at IS NULL AND business_date BETWEEN ? AND ?
       GROUP BY business_date`,
    ).bind(start, end).all<{ d: string; total: number; cash: number; card: number; tx: number }>(),
  ]);

  const zBy = new Map(zRows.results.map((r) => [r.d, r]));
  const posBy = new Map(posRows.results.map((r) => [r.d, r]));
  const dates = [...new Set([...zBy.keys(), ...posBy.keys()])].sort().reverse();

  const rows: ReconRow[] = dates.map((d) => {
    const zr = zBy.get(d) ?? null;
    const pr = posBy.get(d) ?? null;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let status: ReconRow["status"];
    let diff: number | null = null;
    if (zr && pr) {
      diff = r2(pr.total - zr.gross);
      status = Math.abs(diff) <= RECON_TOLERANCE ? "match" : "mismatch";
    } else if (zr) {
      status = "no_pos";
    } else {
      status = "no_z";
    }
    return {
      date: d,
      z_gross: zr ? r2(zr.gross) : null,
      z_cash: zr ? r2(zr.cash) : null,
      z_card: zr ? r2(zr.card) : null,
      pos_total: pr ? r2(pr.total) : null,
      pos_cash: pr ? r2(pr.cash) : null,
      pos_card: pr ? r2(pr.card) : null,
      pos_tx: pr ? pr.tx : 0,
      diff,
      status,
    };
  });
  return c.json({ rows });
});

sales.get("/:id", async (c) => {
  const sale = await loadSale(c.env.DB, Number(c.req.param("id")));
  if (!sale) return c.json({ error: "not_found" }, 404);
  return c.json(sale);
});

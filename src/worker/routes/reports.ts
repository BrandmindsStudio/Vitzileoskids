import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../env";
import { athensToday } from "../dates";
import { extractZReport } from "../../extraction/extract";
import { VatLineSchema, DepartmentSchema } from "../../extraction/schema";
import type { ZReportDetail } from "../../shared/types";

export const reports = new Hono<AppContext>();

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Editable report fields, validated on manual create and on update.
const ReportInputSchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  z_number: z.number().int().min(0).nullable(),
  gross_total: z.number().finite(),
  receipt_count: z.number().int().min(0),
  cash_total: z.number().finite().nullable(),
  card_total: z.number().finite().nullable(),
  discounts_total: z.number().finite().nullable(),
  cancelled_total: z.number().finite().nullable(),
  cancelled_count: z.number().int().nullable(),
  register_serial: z.string().max(100).nullable(),
  aade_transmitted: z.union([z.literal(0), z.literal(1)]).nullable(),
  notes: z.string().max(2000).nullable(),
  vat_lines: z.array(VatLineSchema).max(20),
  departments: z.array(DepartmentSchema).max(30),
  status: z.enum(["pending_review", "confirmed"]),
});
type ReportInput = z.infer<typeof ReportInputSchema>;

// ---------- helpers ----------

async function loadDetail(db: D1Database, id: number): Promise<ZReportDetail | null> {
  const report = await db
    .prepare("SELECT * FROM z_reports WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!report) return null;
  const [vat, dept, photos] = await Promise.all([
    db.prepare("SELECT vat_label, vat_rate, gross_amount, net_amount, vat_amount FROM z_report_vat_lines WHERE z_report_id = ? ORDER BY vat_rate").bind(id).all(),
    db.prepare("SELECT name, amount, items FROM z_report_departments WHERE z_report_id = ? ORDER BY id").bind(id).all(),
    db.prepare("SELECT id, order_index FROM z_report_photos WHERE z_report_id = ? ORDER BY order_index").bind(id).all(),
  ]);
  return {
    ...(report as object),
    vat_lines: vat.results,
    departments: dept.results,
    photos: photos.results,
  } as unknown as ZReportDetail;
}

async function replaceChildren(db: D1Database, id: number, input: ReportInput) {
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM z_report_vat_lines WHERE z_report_id = ?").bind(id),
    db.prepare("DELETE FROM z_report_departments WHERE z_report_id = ?").bind(id),
  ];
  for (const l of input.vat_lines) {
    stmts.push(
      db.prepare(
        "INSERT INTO z_report_vat_lines (z_report_id, vat_label, vat_rate, gross_amount, net_amount, vat_amount) VALUES (?,?,?,?,?,?)",
      ).bind(id, l.vat_label, l.vat_rate, l.gross_amount, l.net_amount, l.vat_amount),
    );
  }
  for (const d of input.departments) {
    stmts.push(
      db.prepare("INSERT INTO z_report_departments (z_report_id, name, amount, items) VALUES (?,?,?,?)")
        .bind(id, d.name, d.amount, d.items),
    );
  }
  await db.batch(stmts);
}

async function findDuplicate(db: D1Database, date: string, zNumber: number, excludeId: number) {
  return db
    .prepare(
      "SELECT id, business_date, z_number, status FROM z_reports WHERE business_date = ? AND z_number = ? AND deleted_at IS NULL AND id != ?",
    )
    .bind(date, zNumber, excludeId)
    .first<{ id: number }>();
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

// ---------- photo upload (step 1: photos are persisted before anything else) ----------

reports.post("/photos", async (c) => {
  const form = await c.req.formData();
  // Workers' FormData types getAll() as string[]; at runtime the entries are Files.
  const files = (form.getAll("photos") as unknown[]).filter(
    (f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f,
  );
  if (files.length === 0 || files.length > MAX_PHOTOS) {
    return c.json({ error: "invalid_photo_count" }, 400);
  }
  for (const f of files) {
    if (f.size === 0 || f.size > MAX_PHOTO_BYTES) return c.json({ error: "photo_too_large" }, 400);
  }

  const user = c.get("user");
  const draft = await c.env.DB
    .prepare(
      "INSERT INTO z_reports (business_date, source, status, created_by) VALUES (?, 'photo', 'pending_review', ?) RETURNING id",
    )
    .bind(athensToday(), user.id)
    .first<{ id: number }>();
  const id = draft!.id;

  const photoStmts: D1PreparedStatement[] = [];
  for (let i = 0; i < files.length; i++) {
    const key = `reports/${id}/${i}-${Date.now()}.jpg`;
    await c.env.PHOTOS.put(key, await files[i].arrayBuffer(), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    photoStmts.push(
      c.env.DB.prepare("INSERT INTO z_report_photos (z_report_id, r2_key, order_index) VALUES (?,?,?)")
        .bind(id, key, i),
    );
  }
  await c.env.DB.batch(photoStmts);
  return c.json({ id }, 201);
});

// ---------- extraction (step 2: never loses photos on failure) ----------

reports.post("/:id/extract", async (c) => {
  const id = Number(c.req.param("id"));
  const report = await c.env.DB
    .prepare("SELECT id, status FROM z_reports WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<{ id: number; status: string }>();
  if (!report) return c.json({ error: "not_found" }, 404);
  if (report.status === "confirmed") return c.json({ error: "already_confirmed" }, 409);

  const photoRows = await c.env.DB
    .prepare("SELECT r2_key FROM z_report_photos WHERE z_report_id = ? ORDER BY order_index")
    .bind(id)
    .all<{ r2_key: string }>();
  if (photoRows.results.length === 0) return c.json({ error: "no_photos" }, 400);

  const buffers: ArrayBuffer[] = [];
  for (const row of photoRows.results) {
    const obj = await c.env.PHOTOS.get(row.r2_key);
    if (obj) buffers.push(await obj.arrayBuffer());
  }

  try {
    const extraction = await extractZReport(c.env.ANTHROPIC_API_KEY, buffers);

    await c.env.DB
      .prepare(
        `UPDATE z_reports SET
           business_date = COALESCE(?, business_date), z_time = ?, z_number = ?,
           gross_total = COALESCE(?, 0), receipt_count = COALESCE(?, 0),
           cash_total = ?, card_total = ?, discounts_total = ?,
           cancelled_total = ?, cancelled_count = ?, register_serial = ?,
           aade_transmitted = ?, extraction_json = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        extraction.business_date, extraction.z_time, extraction.z_number,
        extraction.gross_total, extraction.receipt_count,
        extraction.cash_total, extraction.card_total, extraction.discounts_total,
        extraction.cancelled_total, extraction.cancelled_count, extraction.register_serial,
        extraction.aade_transmitted === null ? null : extraction.aade_transmitted ? 1 : 0,
        JSON.stringify(extraction), id,
      )
      .run();

    await replaceChildren(c.env.DB, id, {
      vat_lines: extraction.vat_lines,
      departments: extraction.departments,
    } as ReportInput);

    return c.json({ ok: true, extraction, report: await loadDetail(c.env.DB, id) });
  } catch (e) {
    // Extraction failed — the draft and its photos remain; the client opens the manual form.
    console.error("extraction_failed", e instanceof Error ? e.message : e);
    return c.json({ ok: false, error: "extraction_failed", report: await loadDetail(c.env.DB, id) }, 502);
  }
});

// ---------- manual entry ----------

reports.post("/manual", async (c) => {
  const parsed = ReportInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const problem = confirmBlockers(input);
  if (problem) return c.json({ error: problem }, 400);

  const user = c.get("user");
  try {
    const row = await c.env.DB
      .prepare(
        `INSERT INTO z_reports (business_date, z_time, z_number, gross_total, receipt_count,
           cash_total, card_total, discounts_total, cancelled_total, cancelled_count,
           register_serial, aade_transmitted, source, status, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?) RETURNING id`,
      )
      .bind(
        input.business_date, input.z_time, input.z_number, input.gross_total, input.receipt_count,
        input.cash_total, input.card_total, input.discounts_total, input.cancelled_total,
        input.cancelled_count, input.register_serial, input.aade_transmitted,
        input.status, input.notes, user.id,
      )
      .first<{ id: number }>();
    const id = row!.id;
    await replaceChildren(c.env.DB, id, input);
    return c.json(await loadDetail(c.env.DB, id), 201);
  } catch (e) {
    if (isUniqueError(e)) {
      const existing = input.z_number != null
        ? await findDuplicate(c.env.DB, input.business_date, input.z_number, -1)
        : null;
      return c.json({ error: "duplicate", existing_id: existing?.id ?? null }, 409);
    }
    throw e;
  }
});

// ---------- duplicate pre-check (used by the review screen) ----------

reports.get("/duplicate", async (c) => {
  const date = c.req.query("business_date");
  const zNumber = Number(c.req.query("z_number"));
  const exclude = Number(c.req.query("exclude_id") ?? -1);
  if (!date || !Number.isInteger(zNumber)) return c.json({ existing: null });
  const existing = await findDuplicate(c.env.DB, date, zNumber, exclude);
  return c.json({ existing: existing ?? null });
});

// ---------- list / detail / update / delete ----------

reports.get("/", async (c) => {
  const month = c.req.query("month"); // YYYY-MM
  let query =
    "SELECT id, business_date, z_time, z_number, gross_total, receipt_count, cash_total, card_total, source, status, created_at FROM z_reports WHERE deleted_at IS NULL";
  const binds: unknown[] = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    query += " AND business_date LIKE ?";
    binds.push(`${month}-%`);
  }
  query += " ORDER BY business_date DESC, z_number DESC LIMIT 500";
  const rows = await c.env.DB.prepare(query).bind(...binds).all();
  return c.json(rows.results);
});

reports.get("/:id", async (c) => {
  const detail = await loadDetail(c.env.DB, Number(c.req.param("id")));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

reports.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await c.env.DB
    .prepare("SELECT id FROM z_reports WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const parsed = ReportInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const problem = confirmBlockers(input);
  if (problem) return c.json({ error: problem }, 400);

  try {
    await c.env.DB
      .prepare(
        `UPDATE z_reports SET business_date=?, z_time=?, z_number=?, gross_total=?, receipt_count=?,
           cash_total=?, card_total=?, discounts_total=?, cancelled_total=?, cancelled_count=?,
           register_serial=?, aade_transmitted=?, status=?, notes=?, updated_at=datetime('now')
         WHERE id=?`,
      )
      .bind(
        input.business_date, input.z_time, input.z_number, input.gross_total, input.receipt_count,
        input.cash_total, input.card_total, input.discounts_total, input.cancelled_total,
        input.cancelled_count, input.register_serial, input.aade_transmitted,
        input.status, input.notes, id,
      )
      .run();
  } catch (e) {
    if (isUniqueError(e)) {
      const dup = input.z_number != null
        ? await findDuplicate(c.env.DB, input.business_date, input.z_number, id)
        : null;
      return c.json({ error: "duplicate", existing_id: dup?.id ?? null }, 409);
    }
    throw e;
  }
  await replaceChildren(c.env.DB, id, input);
  return c.json(await loadDetail(c.env.DB, id));
});

reports.delete("/:id", async (c) => {
  await c.env.DB
    .prepare("UPDATE z_reports SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

/** Hard validations (blocking). The cross-check sums are soft warnings handled client-side. */
function confirmBlockers(input: ReportInput): string | null {
  if (input.business_date > athensToday()) return "future_date";
  if (input.status === "confirmed" && input.z_number == null) return "z_number_required";
  return null;
}

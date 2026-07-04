import { Hono } from "hono";
import type { AppContext } from "../env";

export const exportCsv = new Hono<AppContext>();

// CSV export for the accountant: one row per confirmed report, with one column
// pair per VAT rate (net, vat) and one column per department found in range.
// Comma-delimited, dot decimals, UTF-8 BOM so Excel opens it correctly.
exportCsv.get("/", async (c) => {
  let from = c.req.query("from");
  let to = c.req.query("to");
  const month = c.req.query("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    from = `${month}-01`;
    to = `${month}-31`;
  }
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return c.json({ error: "invalid_range" }, 400);
  }

  const db = c.env.DB;
  const reports = await db
    .prepare(
      `SELECT id, business_date, z_number, gross_total, cash_total, card_total, receipt_count
       FROM z_reports
       WHERE status = 'confirmed' AND deleted_at IS NULL AND business_date >= ? AND business_date <= ?
       ORDER BY business_date, z_number`,
    )
    .bind(from, to)
    .all<{
      id: number; business_date: string; z_number: number | null; gross_total: number;
      cash_total: number | null; card_total: number | null; receipt_count: number;
    }>();

  const ids = reports.results.map((r) => r.id);
  const vatByReport = new Map<number, Map<number, { net: number; vat: number }>>();
  const deptByReport = new Map<number, Map<string, number>>();
  const vatRates = new Set<number>();
  const deptNames = new Set<string>();

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const [vatRows, deptRows] = await Promise.all([
      db.prepare(
        `SELECT z_report_id, vat_rate, COALESCE(SUM(net_amount),0) AS net, COALESCE(SUM(vat_amount),0) AS vat
         FROM z_report_vat_lines WHERE z_report_id IN (${placeholders}) GROUP BY z_report_id, vat_rate`,
      ).bind(...ids).all<{ z_report_id: number; vat_rate: number; net: number; vat: number }>(),
      db.prepare(
        `SELECT z_report_id, name, COALESCE(SUM(amount),0) AS amount
         FROM z_report_departments WHERE z_report_id IN (${placeholders}) GROUP BY z_report_id, name`,
      ).bind(...ids).all<{ z_report_id: number; name: string; amount: number }>(),
    ]);
    for (const v of vatRows.results) {
      vatRates.add(v.vat_rate);
      if (!vatByReport.has(v.z_report_id)) vatByReport.set(v.z_report_id, new Map());
      vatByReport.get(v.z_report_id)!.set(v.vat_rate, { net: v.net, vat: v.vat });
    }
    for (const d of deptRows.results) {
      deptNames.add(d.name);
      if (!deptByReport.has(d.z_report_id)) deptByReport.set(d.z_report_id, new Map());
      deptByReport.get(d.z_report_id)!.set(d.name, d.amount);
    }
  }

  const rates = [...vatRates].sort((a, b) => a - b);
  const names = [...deptNames].sort((a, b) => a.localeCompare(b, "el"));

  const header = [
    "date", "z_number", "gross_total", "cash_total", "card_total", "receipt_count",
    ...rates.flatMap((r) => [`vat_${fmtRate(r)}_net`, `vat_${fmtRate(r)}_vat`]),
    ...names.map((n) => `dept_${n}`),
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const r of reports.results) {
    const vat = vatByReport.get(r.id);
    const dept = deptByReport.get(r.id);
    const row: (string | number | null)[] = [
      r.business_date, r.z_number, num(r.gross_total), num(r.cash_total), num(r.card_total), r.receipt_count,
      ...rates.flatMap((rate) => {
        const v = vat?.get(rate);
        return [v ? num(v.net) : "", v ? num(v.vat) : ""];
      }),
      ...names.map((n) => {
        const a = dept?.get(n);
        return a != null ? num(a) : "";
      }),
    ];
    lines.push(row.map(csvCell).join(","));
  }

  const csv = "﻿" + lines.join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="z-reports_${from}_${to}.csv"`,
    },
  });
});

function fmtRate(r: number): string {
  return Number.isInteger(r) ? String(r) : String(r).replace(".", "_");
}

function num(n: number | null): string {
  return n == null ? "" : (Math.round(n * 100) / 100).toFixed(2);
}

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

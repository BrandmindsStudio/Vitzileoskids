import { Hono } from "hono";
import type { AppContext } from "../env";
import { athensToday, addDays, weekday, monthStart, prevMonthStart, weekStart } from "../dates";
import type { DashboardData } from "../../shared/types";

export const dashboard = new Hono<AppContext>();

// Aggregates use confirmed reports only.
const CONFIRMED = "status = 'confirmed' AND deleted_at IS NULL";

dashboard.get("/", async (c) => {
  const db = c.env.DB;
  const today = athensToday();
  const mStart = monthStart(today);
  const pmStart = prevMonthStart(today);
  const wStart = weekStart(today);
  const d90 = addDays(today, -89);

  const sumRange = (from: string, to: string) =>
    db.prepare(
      `SELECT COALESCE(SUM(gross_total),0) AS total, COALESCE(SUM(receipt_count),0) AS count
       FROM z_reports WHERE ${CONFIRMED} AND business_date >= ? AND business_date <= ?`,
    ).bind(from, to).first<{ total: number; count: number }>();

  const [todayAgg, weekAgg, monthAgg, prevMonthAgg, dailyRows, cashCard, deptRows, vatRows, confirmedDays, settingsRow] =
    await Promise.all([
      sumRange(today, today),
      sumRange(wStart, today),
      sumRange(mStart, today),
      sumRange(pmStart, addDays(mStart, -1)),
      db.prepare(
        `SELECT business_date AS date, SUM(gross_total) AS total
         FROM z_reports WHERE ${CONFIRMED} AND business_date >= ?
         GROUP BY business_date ORDER BY business_date`,
      ).bind(d90).all<{ date: string; total: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(cash_total),0) AS cash, COALESCE(SUM(card_total),0) AS card
         FROM z_reports WHERE ${CONFIRMED} AND business_date >= ?`,
      ).bind(mStart).first<{ cash: number; card: number }>(),
      db.prepare(
        `SELECT d.name AS name, COALESCE(SUM(d.amount),0) AS amount, COALESCE(SUM(d.items),0) AS items
         FROM z_report_departments d
         JOIN z_reports r ON r.id = d.z_report_id
         WHERE r.${CONFIRMED} AND r.business_date >= ?
         GROUP BY d.name ORDER BY amount DESC`,
      ).bind(mStart).all<{ name: string; amount: number; items: number }>(),
      db.prepare(
        `SELECT v.vat_rate AS vat_rate,
                COALESCE(SUM(v.gross_amount),0) AS gross,
                COALESCE(SUM(v.net_amount),0) AS net,
                COALESCE(SUM(v.vat_amount),0) AS vat
         FROM z_report_vat_lines v
         JOIN z_reports r ON r.id = v.z_report_id
         WHERE r.${CONFIRMED} AND r.business_date >= ?
         GROUP BY v.vat_rate ORDER BY v.vat_rate`,
      ).bind(mStart).all<{ vat_rate: number; gross: number; net: number; vat: number }>(),
      db.prepare(
        `SELECT DISTINCT business_date FROM z_reports
         WHERE ${CONFIRMED} AND business_date >= ?`,
      ).bind(addDays(today, -13)).all<{ business_date: string }>(),
      db.prepare("SELECT value FROM settings WHERE key = 'closed_weekdays'").first<{ value: string }>(),
    ]);

  let closedWeekdays: number[] = [0];
  try {
    if (settingsRow?.value) closedWeekdays = JSON.parse(settingsRow.value);
  } catch {
    // keep default
  }

  const covered = new Set(confirmedDays.results.map((r) => r.business_date));
  const missing: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    if (d === today) continue; // today's Z is printed at closing — not "missing" yet
    if (closedWeekdays.includes(weekday(d))) continue;
    if (!covered.has(d)) missing.push(d);
  }

  const monthTotal = monthAgg?.total ?? 0;
  const prevTotal = prevMonthAgg?.total ?? 0;
  const pct = prevTotal > 0 ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;

  const data: DashboardData = {
    today: todayAgg ?? { total: 0, count: 0 },
    week: weekAgg ?? { total: 0, count: 0 },
    month: monthAgg ?? { total: 0, count: 0 },
    prev_month: prevMonthAgg ?? { total: 0, count: 0 },
    month_over_month_pct: pct,
    daily: dailyRows.results,
    cash_card: cashCard ?? { cash: 0, card: 0 },
    departments: deptRows.results,
    missing_days: missing,
    vat_table: vatRows.results,
    vat_month: today.slice(0, 7),
  };
  return c.json(data);
});

// Monthly VAT table for an arbitrary month (accountant view).
dashboard.get("/vat", async (c) => {
  const month = c.req.query("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "invalid_month" }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT v.vat_rate AS vat_rate,
              COALESCE(SUM(v.gross_amount),0) AS gross,
              COALESCE(SUM(v.net_amount),0) AS net,
              COALESCE(SUM(v.vat_amount),0) AS vat
       FROM z_report_vat_lines v
       JOIN z_reports r ON r.id = v.z_report_id
       WHERE r.${CONFIRMED} AND r.business_date LIKE ?
       GROUP BY v.vat_rate ORDER BY v.vat_rate`,
    )
    .bind(`${month}-%`)
    .all();
  return c.json(rows.results);
});

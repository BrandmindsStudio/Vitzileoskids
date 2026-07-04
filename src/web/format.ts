// el-GR formatting helpers — EUR amounts and dates.

const eur = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" });
const eurNoDecimals = new Intl.NumberFormat("el-GR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("el-GR");

export function fmtEur(n: number | null | undefined): string {
  return n == null ? "—" : eur.format(n);
}

export function fmtEurShort(n: number | null | undefined): string {
  return n == null ? "—" : eurNoDecimals.format(n);
}

export function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : num.format(n);
}

/** YYYY-MM-DD → e.g. "Παρ 3 Ιουλ 2026" */
export function fmtDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("el-GR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** YYYY-MM-DD → "3/7" (chart axis) */
export function fmtDayShort(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** YYYY-MM → "Ιούλιος 2026" */
export function fmtMonth(month: string): string {
  const d = new Date(`${month}-01T12:00:00`);
  return d.toLocaleDateString("el-GR", { month: "long", year: "numeric" });
}

/** Today's date (YYYY-MM-DD) in Europe/Athens. */
export function athensToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function parseAmount(s: string): number | null {
  if (s.trim() === "") return null;
  // Accept both Greek ("1.234,56") and plain ("1234.56") input.
  const normalized = /,\d{1,2}$/.test(s.trim())
    ? s.trim().replace(/\./g, "").replace(",", ".")
    : s.trim().replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

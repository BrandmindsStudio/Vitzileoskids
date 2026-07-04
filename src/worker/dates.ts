// All business-date logic runs in Europe/Athens regardless of where the Worker executes.

const ATHENS = "Europe/Athens";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ATHENS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Athens as YYYY-MM-DD. */
export function athensToday(): string {
  return dateFmt.format(new Date());
}

/** Shift a YYYY-MM-DD date by n days (calendar arithmetic, timezone-safe via UTC noon). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** JS weekday (0 = Sunday) of a YYYY-MM-DD date. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** First day of the month containing the given date. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the previous month. */
export function prevMonthStart(date: string): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

/** Monday of the week containing the given date (Greek week starts Monday). */
export function weekStart(date: string): string {
  const wd = weekday(date); // 0=Sun..6=Sat
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(date, -back);
}

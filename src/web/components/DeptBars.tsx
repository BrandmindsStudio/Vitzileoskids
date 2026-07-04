import { fmtEur, fmtNum } from "../format";

/**
 * Department split, current month. Identity is carried by the row label, so a
 * single hue is correct — magnitude is the only encoded quantity. Values are
 * printed directly (no tooltip needed for a labeled bar list).
 */
export default function DeptBars({
  departments,
}: {
  departments: { name: string; amount: number; items: number }[];
}) {
  if (departments.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">Δεν υπάρχουν δεδομένα τμημάτων αυτόν τον μήνα.</p>;
  }
  const max = Math.max(...departments.map((d) => d.amount), 1);

  return (
    <ul className="space-y-3">
      {departments.map((d) => (
        <li key={d.name}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">{d.name}</span>
            <span>
              <strong>{fmtEur(d.amount)}</strong>
              <span className="ml-2 text-xs text-[var(--ink-muted)]">{fmtNum(d.items)} τεμ.</span>
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[var(--grid)]">
            <div
              className="h-2.5 rounded-full"
              style={{ width: `${Math.max(2, (d.amount / max) * 100)}%`, background: "var(--series-1)" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

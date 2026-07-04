import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ZReport } from "../../shared/types";
import { fmtEur, fmtDate, athensToday } from "../format";

export default function Reports() {
  const [month, setMonth] = useState(athensToday().slice(0, 7));
  const [rows, setRows] = useState<ZReport[] | null>(null);

  useEffect(() => {
    setRows(null);
    api.get<ZReport[]>(`/api/reports?month=${month}`).then(setRows).catch(() => setRows([]));
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Αναφορές</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl border border-black/15 bg-[var(--surface-1)] px-3 py-2 text-sm"
        />
      </div>

      <a
        href={`/api/export?month=${month}`}
        className="block rounded-xl border border-black/15 bg-[var(--surface-1)] py-3 text-center text-sm font-semibold"
      >
        ⬇︎ Εξαγωγή CSV μήνα (λογιστής)
      </a>

      {rows === null && <p className="py-6 text-center text-sm text-[var(--ink-muted)]">Φόρτωση…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">Δεν υπάρχουν δελτία αυτόν τον μήνα.</p>
      )}

      <ul className="space-y-2">
        {rows?.map((r) => (
          <li key={r.id}>
            <Link
              to={`/reports/${r.id}`}
              className="flex items-center justify-between rounded-2xl bg-[var(--surface-1)] px-4 py-3 shadow-sm ring-1 ring-black/10"
            >
              <div>
                <p className="font-semibold">{fmtDate(r.business_date)}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  Ζ {r.z_number ?? "—"} · {r.receipt_count} αποδ. · {r.source === "photo" ? "📷" : r.source === "manual" ? "✍️" : "☁️"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{fmtEur(r.gross_total)}</p>
                <StatusBadge status={r.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return status === "confirmed" ? (
    <span className="text-xs font-medium" style={{ color: "var(--delta-up)" }}>✓ Επιβεβαιωμένο</span>
  ) : (
    <span className="text-xs font-medium" style={{ color: "#8a5a00" }}>● Σε έλεγχο</span>
  );
}

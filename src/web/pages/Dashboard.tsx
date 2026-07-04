import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { DashboardData } from "../../shared/types";
import { fmtEur, fmtDate, fmtMonth, fmtNum } from "../format";
import DailyBarChart from "../components/DailyBarChart";
import CashCardSplit from "../components/CashCardSplit";
import DeptBars from "../components/DeptBars";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState<30 | 90>(30);

  useEffect(() => {
    api.get<DashboardData>("/api/dashboard").then(setData).catch(() => setError(true));
  }, []);

  if (error) return <p className="py-8 text-center text-sm text-[var(--delta-down)]">Σφάλμα φόρτωσης.</p>;
  if (!data) return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Φόρτωση…</p>;

  const pct = data.month_over_month_pct;

  return (
    <div className="space-y-4">
      {data.missing_days.length > 0 && (
        <div className="rounded-xl border border-[var(--warning)]/60 bg-[var(--warning)]/10 px-4 py-3 text-sm">
          <span aria-hidden>⚠️ </span>
          <strong>Λείπουν δελτία «Ζ»</strong> για:{" "}
          {data.missing_days.map((d, i) => (
            <span key={d}>
              {i > 0 && ", "}
              {fmtDate(d)}
            </span>
          ))}
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Σήμερα" value={data.today.total} sub={`${fmtNum(data.today.count)} αποδ.`} />
        <StatCard label="Εβδομάδα" value={data.week.total} sub={`${fmtNum(data.week.count)} αποδ.`} />
        <StatCard
          label="Μήνας"
          value={data.month.total}
          sub={
            pct == null ? (
              `${fmtNum(data.month.count)} αποδ.`
            ) : (
              <span style={{ color: pct >= 0 ? "var(--delta-up)" : "var(--delta-down)" }}>
                {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% vs {fmtMonth(prevMonth(data.vat_month))}
              </span>
            )
          }
        />
      </div>

      {/* Daily sales */}
      <Card
        title="Ημερήσιες πωλήσεις"
        action={
          <div className="flex gap-1 text-xs">
            {([30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-lg px-2.5 py-1 ${
                  days === d ? "bg-[var(--series-1)] font-semibold text-white" : "text-[var(--ink-2)]"
                }`}
              >
                {d} ημ.
              </button>
            ))}
          </div>
        }
      >
        <DailyBarChart data={data.daily} days={days} />
      </Card>

      <Card title={`Μετρητά / Κάρτα — ${fmtMonth(data.vat_month)}`}>
        <CashCardSplit cash={data.cash_card.cash} card={data.cash_card.card} />
      </Card>

      <Card title={`Τμήματα — ${fmtMonth(data.vat_month)}`}>
        <DeptBars departments={data.departments} />
      </Card>

      <Card title={`ΦΠΑ ανά συντελεστή — ${fmtMonth(data.vat_month)}`}>
        {data.vat_table.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">Δεν υπάρχουν δεδομένα.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--ink-muted)]">
                <th className="py-1 font-medium">Συντ.</th>
                <th className="py-1 text-right font-medium">Μικτά</th>
                <th className="py-1 text-right font-medium">Καθαρά</th>
                <th className="py-1 text-right font-medium">ΦΠΑ</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.vat_table
                .filter((v) => v.gross !== 0 || v.net !== 0 || v.vat !== 0)
                .map((v) => (
                  <tr key={v.vat_rate} className="border-t border-[var(--grid)]">
                    <td className="py-1.5">{v.vat_rate}%</td>
                    <td className="py-1.5 text-right">{fmtEur(v.gross)}</td>
                    <td className="py-1.5 text-right">{fmtEur(v.net)}</td>
                    <td className="py-1.5 text-right">{fmtEur(v.vat)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="text-center">
        <Link to="/upload" className="inline-block rounded-xl bg-[var(--series-1)] px-6 py-3 font-semibold text-white">
          📷 Ανέβασμα σημερινού «Ζ»
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: ReactNode }) {
  return (
    <div className="rounded-2xl bg-[var(--surface-1)] p-3 shadow-sm ring-1 ring-black/10">
      <p className="text-xs text-[var(--ink-2)]">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold">{fmtEur(value)}</p>
      <p className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]">{sub}</p>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-[var(--surface-1)] p-4 shadow-sm ring-1 ring-black/10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

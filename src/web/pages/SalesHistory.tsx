import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { fmtEur, fmtDate, athensToday } from "../format";
import type { ReconRow, Sale, SalesDay } from "../../shared/types";

export default function SalesHistory() {
  const [date, setDate] = useState(athensToday());
  const [day, setDay] = useState<SalesDay | null>(null);
  const [recon, setRecon] = useState<ReconRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [dayRes, reconRes] = await Promise.all([
        api.get<SalesDay>(`/api/sales?date=${d}`),
        api.get<{ rows: ReconRow[] }>(`/api/sales/reconciliation?date=${d}`),
      ]);
      setDay(dayRes);
      setRecon(reconRes.rows[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const shift = (n: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + n);
    setDate(d.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Πωλήσεις ημέρας</h2>

      <div className="flex items-center gap-2">
        <button onClick={() => shift(-1)} className="rounded-lg bg-[var(--surface-1)] px-3 py-2 font-bold ring-1 ring-black/10">←</button>
        <input
          type="date"
          value={date}
          max={athensToday()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="flex-1 rounded-lg border border-black/15 bg-[var(--surface-1)] px-3 py-2 text-center"
        />
        <button onClick={() => shift(1)} disabled={date >= athensToday()} className="rounded-lg bg-[var(--surface-1)] px-3 py-2 font-bold ring-1 ring-black/10 disabled:opacity-30">→</button>
      </div>

      {day && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tile label="Σύνολο" value={fmtEur(day.totals.total)} />
          <Tile label="Μετρητά" value={fmtEur(day.totals.cash)} />
          <Tile label="Κάρτα" value={fmtEur(day.totals.card)} />
        </div>
      )}

      {recon && <ReconBanner r={recon} />}

      {loading ? (
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">Φόρτωση…</p>
      ) : !day || day.sales.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">Καμία κίνηση στο ταμείο ({fmtDate(date)}).</p>
      ) : (
        <ul className="space-y-2">
          {day.sales.map((s) => (
            <SaleRow key={s.id} s={s} onVoided={() => load(date)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-1)] p-2.5 ring-1 ring-black/10">
      <p className="text-[11px] text-[var(--ink-muted)]">{label}</p>
      <p className="truncate text-sm font-bold">{value}</p>
    </div>
  );
}

/** The Z ↔ POS verdict for the day. */
function ReconBanner({ r }: { r: ReconRow }) {
  if (r.status === "match") {
    return (
      <p className="rounded-xl bg-[var(--series-2)]/10 px-4 py-3 text-sm ring-1 ring-[var(--series-2)]/40">
        ✅ <strong>Συμφωνεί με το «Ζ»</strong> — ταμειακή {fmtEur(r.z_gross)} = ταμείο εφαρμογής {fmtEur(r.pos_total)}.
      </p>
    );
  }
  if (r.status === "mismatch") {
    return (
      <p className="rounded-xl bg-[var(--delta-down)]/10 px-4 py-3 text-sm ring-1 ring-[var(--delta-down)]/40">
        ❗ <strong>Διαφορά {fmtEur(Math.abs(r.diff!))}</strong> — ταμειακή («Ζ») {fmtEur(r.z_gross)}, ταμείο εφαρμογής{" "}
        {fmtEur(r.pos_total)}. {r.diff! > 0 ? "Καταγράφηκε παραπάνω στην εφαρμογή (ξεχάστηκε απόδειξη;)." : "Λείπουν πωλήσεις από την εφαρμογή (πουλήθηκε χωρίς σκανάρισμα;)."}
      </p>
    );
  }
  if (r.status === "no_z" && (r.pos_total ?? 0) !== 0) {
    return (
      <p className="rounded-xl bg-[var(--warning)]/10 px-4 py-3 text-sm ring-1 ring-[var(--warning)]/60">
        ⏳ Δεν έχει καταχωρηθεί «Ζ» για τη μέρα ακόμα — το ταμείο δείχνει {fmtEur(r.pos_total)}.
      </p>
    );
  }
  return null;
}

function SaleRow({ s, onVoided }: { s: Sale; onVoided: () => void }) {
  const [busy, setBusy] = useState(false);
  const time = s.created_at.slice(11, 16); // UTC — indicative ordering only

  const voidSale = async () => {
    if (!confirm(`Ακύρωση ${s.type === "sale" ? "πώλησης" : "επιστροφής"} ${fmtEur(s.total)}; Το απόθεμα θα επανέλθει.`)) return;
    setBusy(true);
    try {
      await api.post(`/api/sales/${s.id}/void`);
      onVoided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`rounded-xl bg-[var(--surface-1)] p-3 ring-1 ring-black/10 ${s.voided_at ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {s.type === "sale" ? "🛒 Πώληση" : "↩️ Επιστροφή"} #{s.id}
          {s.voided_at && <span className="ml-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">ΑΚΥΡΩΜΕΝΗ</span>}
        </p>
        <p className="text-sm font-bold">{s.type === "return" ? "−" : ""}{fmtEur(s.total)}</p>
      </div>
      <p className="text-xs text-[var(--ink-muted)]">
        {s.payment_method === "cash" ? "💶 μετρητά" : "💳 κάρτα"} · {time} UTC
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {s.lines.map((l) => (
          <li key={l.id} className="flex justify-between text-xs text-[var(--ink-2)]">
            <span className="min-w-0 truncate">
              {l.quantity}× {l.product_name}
              {l.variant_label ? ` (${l.variant_label})` : ""}
            </span>
            <span className="shrink-0 pl-2 tabular-nums">{fmtEur(l.line_total)}</span>
          </li>
        ))}
      </ul>
      {!s.voided_at && (
        <button onClick={voidSale} disabled={busy} className="mt-2 text-xs font-semibold text-[var(--delta-down)] disabled:opacity-50">
          Ακύρωση συναλλαγής
        </button>
      )}
    </li>
  );
}

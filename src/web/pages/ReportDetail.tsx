import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { api, ApiError } from "../api";
import type { ExtractionResult, ZReportDetail } from "../../shared/types";
import { fmtEur, fmtDate, fmtNum } from "../format";
import ReportForm, { type ReportPayload } from "../components/ReportForm";
import PhotoViewer from "../components/PhotoViewer";

export default function ReportDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [report, setReport] = useState<ZReportDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(params.get("review") === "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extractionFailed = params.get("extraction_failed") === "1";

  const load = () => {
    api
      .get<ZReportDetail>(`/api/reports/${id}`)
      .then(setReport)
      .catch(() => setNotFound(true));
  };
  useEffect(load, [id]);

  if (notFound) return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Το δελτίο δεν βρέθηκε.</p>;
  if (!report) return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Φόρτωση…</p>;

  const extraction: ExtractionResult | null = report.extraction_json
    ? (JSON.parse(report.extraction_json) as ExtractionResult)
    : null;

  const submit = async (payload: ReportPayload) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.put<ZReportDetail>(`/api/reports/${report.id}`, payload);
      setReport(updated);
      setEditing(false);
      window.scrollTo(0, 0);
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate") {
        setError("Υπάρχει ήδη δελτίο με αυτή την ημερομηνία και αριθμό «Ζ».");
      } else if (e instanceof ApiError && e.code === "future_date") {
        setError("Η ημερομηνία δεν μπορεί να είναι στο μέλλον.");
      } else if (e instanceof ApiError && e.code === "z_number_required") {
        setError("Ο αριθμός «Ζ» είναι υποχρεωτικός για επιβεβαίωση.");
      } else {
        setError("Σφάλμα αποθήκευσης.");
      }
    } finally {
      setBusy(false);
    }
  };

  const softDelete = async () => {
    if (!confirm("Να διαγραφεί αυτό το δελτίο; (μπορεί να ξανακαταχωρηθεί)")) return;
    await api.delete(`/api/reports/${report.id}`);
    navigate("/reports");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">
            {report.z_number != null ? `Δελτίο «Ζ» ${report.z_number}` : "Δελτίο «Ζ» (χωρίς αριθμό)"}
          </h2>
          <p className="text-sm text-[var(--ink-2)]">
            {fmtDate(report.business_date)}
            {report.z_time ? ` · ${report.z_time}` : ""}
          </p>
        </div>
        {report.status === "confirmed" ? (
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ color: "var(--delta-up)", background: "#00630014" }}>
            ✓ Επιβεβαιωμένο
          </span>
        ) : (
          <span className="rounded-full bg-[var(--warning)]/15 px-3 py-1 text-xs font-semibold" style={{ color: "#8a5a00" }}>
            ● Σε έλεγχο
          </span>
        )}
      </div>

      {extractionFailed && editing && (
        <div className="rounded-xl border border-[var(--warning)]/60 bg-[var(--warning)]/10 px-4 py-3 text-sm">
          ⚠️ Η αυτόματη ανάγνωση απέτυχε. Οι φωτογραφίες αποθηκεύτηκαν — συμπληρώστε τα στοιχεία κοιτώντας τες.
        </div>
      )}

      {report.photos.length > 0 && <PhotoViewer photos={report.photos} />}

      {error && (
        <p className="rounded-xl bg-[var(--delta-down)]/10 px-4 py-3 text-sm text-[var(--delta-down)]">{error}</p>
      )}

      {editing ? (
        <>
          <ReportForm initial={report} extraction={extraction} excludeId={report.id} busy={busy} onSubmit={submit} />
          <button onClick={() => setEditing(false)} className="w-full py-2 text-sm text-[var(--ink-muted)]">
            Ακύρωση επεξεργασίας
          </button>
        </>
      ) : (
        <>
          <section className="rounded-2xl bg-[var(--surface-1)] p-4 shadow-sm ring-1 ring-black/10">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Item label="Σύνολο εισπράξεων" value={<strong className="text-base">{fmtEur(report.gross_total)}</strong>} />
              <Item label="Αποδείξεις" value={fmtNum(report.receipt_count)} />
              <Item label="Μετρητά" value={fmtEur(report.cash_total)} />
              <Item label="Κάρτα" value={fmtEur(report.card_total)} />
              <Item label="Εκπτώσεις" value={fmtEur(report.discounts_total)} />
              <Item
                label="Ακυρωμένες"
                value={
                  report.cancelled_total != null
                    ? `${fmtEur(report.cancelled_total)} (${fmtNum(report.cancelled_count)})`
                    : "—"
                }
              />
              <Item label="Αρ. Μητρώου" value={report.register_serial ?? "—"} />
              <Item
                label="ΑΑΔΕ"
                value={report.aade_transmitted === 1 ? "✓ OK" : report.aade_transmitted === 0 ? "✗ Απέτυχε" : "Άγνωστο"}
              />
            </dl>
            {report.notes && <p className="mt-3 border-t border-[var(--grid)] pt-2 text-sm text-[var(--ink-2)]">{report.notes}</p>}
          </section>

          {report.vat_lines.length > 0 && (
            <section className="rounded-2xl bg-[var(--surface-1)] p-4 shadow-sm ring-1 ring-black/10">
              <h3 className="mb-2 text-sm font-semibold">ΦΠΑ</h3>
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-[var(--ink-muted)]">
                    <th className="py-1 font-medium">Κατ.</th>
                    <th className="py-1 text-right font-medium">Μικτά</th>
                    <th className="py-1 text-right font-medium">Καθαρά</th>
                    <th className="py-1 text-right font-medium">ΦΠΑ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.vat_lines.map((l, i) => (
                    <tr key={i} className="border-t border-[var(--grid)]">
                      <td className="py-1.5">{l.vat_label} {l.vat_rate}%</td>
                      <td className="py-1.5 text-right">{fmtEur(l.gross_amount)}</td>
                      <td className="py-1.5 text-right">{fmtEur(l.net_amount)}</td>
                      <td className="py-1.5 text-right">{fmtEur(l.vat_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {report.departments.length > 0 && (
            <section className="rounded-2xl bg-[var(--surface-1)] p-4 shadow-sm ring-1 ring-black/10">
              <h3 className="mb-2 text-sm font-semibold">Τμήματα</h3>
              <ul className="space-y-1.5 text-sm">
                {report.departments.map((d, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{d.name}</span>
                    <span className="tabular-nums">
                      <strong>{fmtEur(d.amount)}</strong>
                      <span className="ml-2 text-xs text-[var(--ink-muted)]">{fmtNum(d.items)} τεμ.</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-xl border border-black/15 bg-[var(--surface-1)] py-3 font-semibold"
            >
              ✎ Επεξεργασία
            </button>
            <button onClick={softDelete} className="rounded-xl px-4 py-3 text-[var(--delta-down)]">
              🗑
            </button>
          </div>
          <p className="text-center">
            <Link to="/reports" className="text-sm text-[var(--ink-muted)] underline">← Όλες οι αναφορές</Link>
          </p>
        </>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--ink-muted)]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import ReportForm, { type ReportPayload } from "../components/ReportForm";
import type { ZReportDetail } from "../../shared/types";

export default function Manual() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (payload: ReportPayload) => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<ZReportDetail>("/api/reports/manual", payload);
      navigate(`/reports/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate") {
        setError("Υπάρχει ήδη δελτίο με αυτή την ημερομηνία και αριθμό «Ζ».");
      } else if (e instanceof ApiError && e.code === "future_date") {
        setError("Η ημερομηνία δεν μπορεί να είναι στο μέλλον.");
      } else {
        setError("Σφάλμα αποθήκευσης. Δοκιμάστε ξανά.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Χειροκίνητη καταχώρηση «Ζ»</h2>
      {error && (
        <p className="rounded-xl bg-[var(--delta-down)]/10 px-4 py-3 text-sm text-[var(--delta-down)]">{error}</p>
      )}
      <ReportForm busy={busy} onSubmit={submit} />
    </div>
  );
}

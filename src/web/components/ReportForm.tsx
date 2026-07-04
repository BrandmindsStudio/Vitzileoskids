import { useEffect, useMemo, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { crossChecks, TOLERANCE } from "../../extraction/schema";
import type { ExtractionResult, ZReportDetail } from "../../shared/types";
import { athensToday, fmtEur, parseAmount } from "../format";

export interface ReportPayload {
  business_date: string;
  z_time: string | null;
  z_number: number | null;
  gross_total: number;
  receipt_count: number;
  cash_total: number | null;
  card_total: number | null;
  discounts_total: number | null;
  cancelled_total: number | null;
  cancelled_count: number | null;
  register_serial: string | null;
  aade_transmitted: 0 | 1 | null;
  notes: string | null;
  vat_lines: { vat_label: string; vat_rate: number; gross_amount: number | null; net_amount: number | null; vat_amount: number | null }[];
  departments: { name: string; amount: number | null; items: number | null }[];
  status: "pending_review" | "confirmed";
}

interface VatRow {
  vat_label: string;
  vat_rate: string;
  gross_amount: string;
  net_amount: string;
  vat_amount: string;
}
interface DeptRow {
  name: string;
  amount: string;
  items: string;
}

interface Props {
  initial?: Partial<ZReportDetail> | null;
  extraction?: ExtractionResult | null; // for low-confidence highlighting
  excludeId?: number; // when editing, exclude self from duplicate check
  busy?: boolean;
  onSubmit: (payload: ReportPayload, confirm: boolean) => void;
}

const s = (v: unknown) => (v == null ? "" : String(v));

export default function ReportForm({ initial, extraction, excludeId, busy, onSubmit }: Props) {
  const [businessDate, setBusinessDate] = useState(s(initial?.business_date) || athensToday());
  const [zTime, setZTime] = useState(s(initial?.z_time));
  const [zNumber, setZNumber] = useState(s(initial?.z_number));
  const [grossTotal, setGrossTotal] = useState(s(initial?.gross_total));
  const [receiptCount, setReceiptCount] = useState(s(initial?.receipt_count));
  const [cashTotal, setCashTotal] = useState(s(initial?.cash_total));
  const [cardTotal, setCardTotal] = useState(s(initial?.card_total));
  const [discounts, setDiscounts] = useState(s(initial?.discounts_total));
  const [cancelledTotal, setCancelledTotal] = useState(s(initial?.cancelled_total));
  const [cancelledCount, setCancelledCount] = useState(s(initial?.cancelled_count));
  const [registerSerial, setRegisterSerial] = useState(s(initial?.register_serial));
  const [aade, setAade] = useState<string>(initial?.aade_transmitted == null ? "" : String(initial.aade_transmitted));
  const [notes, setNotes] = useState(s(initial?.notes));
  const [vatRows, setVatRows] = useState<VatRow[]>(
    (initial?.vat_lines ?? []).map((l) => ({
      vat_label: s(l.vat_label),
      vat_rate: s(l.vat_rate),
      gross_amount: s(l.gross_amount),
      net_amount: s(l.net_amount),
      vat_amount: s(l.vat_amount),
    })),
  );
  const [deptRows, setDeptRows] = useState<DeptRow[]>(
    (initial?.departments ?? []).map((d) => ({ name: s(d.name), amount: s(d.amount), items: s(d.items) })),
  );
  const [duplicate, setDuplicate] = useState<{ id: number } | null>(null);

  const lowConfidence = useMemo(() => {
    const conf = extraction?.confidence ?? {};
    return new Set(Object.entries(conf).filter(([, v]) => v === "low").map(([k]) => k));
  }, [extraction]);

  // Duplicate (business_date, z_number) pre-check with a link to the existing record.
  useEffect(() => {
    const z = Number(zNumber);
    if (!businessDate || !zNumber || !Number.isInteger(z)) {
      setDuplicate(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<{ existing: { id: number } | null }>(
          `/api/reports/duplicate?business_date=${businessDate}&z_number=${z}&exclude_id=${excludeId ?? -1}`,
        )
        .then((r) => setDuplicate(r.existing))
        .catch(() => setDuplicate(null));
    }, 400);
    return () => clearTimeout(t);
  }, [businessDate, zNumber, excludeId]);

  const payloadPreview = useMemo(
    () => ({
      gross_total: parseAmount(grossTotal),
      cash_total: parseAmount(cashTotal),
      card_total: parseAmount(cardTotal),
      vat_lines: vatRows.map((r) => ({ gross_amount: parseAmount(r.gross_amount) })),
      departments: deptRows.map((r) => ({ amount: parseAmount(r.amount) })),
    }),
    [grossTotal, cashTotal, cardTotal, vatRows, deptRows],
  );

  const warnings = useMemo(() => {
    const checks = crossChecks(payloadPreview).filter((c) => !c.ok);
    const msgs: string[] = [];
    for (const c of checks) {
      if (c.key === "cash_plus_card")
        msgs.push(`Μετρητά + Κάρτα = ${fmtEur(c.actual)} ≠ Σύνολο ${fmtEur(c.expected)} (ανοχή ±${TOLERANCE.toFixed(2)}€)`);
      if (c.key === "vat_sum") msgs.push(`Άθροισμα ΦΠΑ = ${fmtEur(c.actual)} ≠ Σύνολο ${fmtEur(c.expected)}`);
      if (c.key === "department_sum") msgs.push(`Άθροισμα τμημάτων = ${fmtEur(c.actual)} ≠ Σύνολο ${fmtEur(c.expected)}`);
    }
    return msgs;
  }, [payloadPreview]);

  const futureDate = businessDate > athensToday();

  const buildPayload = (confirm: boolean): ReportPayload | null => {
    const gross = parseAmount(grossTotal);
    if (gross == null) return null;
    return {
      business_date: businessDate,
      z_time: zTime || null,
      z_number: zNumber === "" ? null : Number(zNumber),
      gross_total: gross,
      receipt_count: receiptCount === "" ? 0 : Number(receiptCount),
      cash_total: parseAmount(cashTotal),
      card_total: parseAmount(cardTotal),
      discounts_total: parseAmount(discounts),
      cancelled_total: parseAmount(cancelledTotal),
      cancelled_count: cancelledCount === "" ? null : Number(cancelledCount),
      register_serial: registerSerial || null,
      aade_transmitted: aade === "" ? null : (Number(aade) as 0 | 1),
      notes: notes || null,
      vat_lines: vatRows
        .filter((r) => r.vat_label !== "" || r.vat_rate !== "")
        .map((r) => ({
          vat_label: r.vat_label,
          vat_rate: parseAmount(r.vat_rate) ?? 0,
          gross_amount: parseAmount(r.gross_amount),
          net_amount: parseAmount(r.net_amount),
          vat_amount: parseAmount(r.vat_amount),
        })),
      departments: deptRows
        .filter((r) => r.name !== "")
        .map((r) => ({ name: r.name, amount: parseAmount(r.amount), items: parseAmount(r.items) })),
      status: confirm ? "confirmed" : "pending_review",
    };
  };

  const submit = (confirm: boolean) => {
    const payload = buildPayload(confirm);
    if (!payload) {
      alert("Συμπληρώστε το Σύνολο Εισπράξεων.");
      return;
    }
    if (confirm && payload.z_number == null) {
      alert("Ο αριθμός «Ζ» είναι υποχρεωτικός για επιβεβαίωση.");
      return;
    }
    onSubmit(payload, confirm);
  };

  const low = (key: string) =>
    lowConfidence.has(key) ? "ring-2 ring-[var(--warning)]" : "";

  return (
    <div className="space-y-4">
      {(warnings.length > 0 || duplicate || futureDate) && (
        <div className="space-y-1 rounded-xl border border-[var(--warning)]/60 bg-[var(--warning)]/10 px-4 py-3 text-sm">
          {futureDate && <p>🚫 Η ημερομηνία είναι στο μέλλον — δεν μπορεί να αποθηκευτεί.</p>}
          {duplicate && (
            <p>
              ⚠️ Υπάρχει ήδη δελτίο με ίδια ημερομηνία και αριθμό «Ζ».{" "}
              <Link to={`/reports/${duplicate.id}`} className="font-semibold underline">
                Δείτε το εδώ
              </Link>
            </p>
          )}
          {warnings.map((w) => (
            <p key={w}>⚠️ {w}</p>
          ))}
        </div>
      )}

      <Section title="Βασικά στοιχεία">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ημερομηνία *">
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)}
              max={athensToday()} className={`${inputCls} ${low("business_date")}`} />
          </Field>
          <Field label="Ώρα «Ζ»">
            <input type="time" value={zTime} onChange={(e) => setZTime(e.target.value)}
              className={`${inputCls} ${low("z_time")}`} />
          </Field>
          <Field label="Αριθμός «Ζ» *">
            <input inputMode="numeric" value={zNumber} onChange={(e) => setZNumber(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} ${low("z_number")}`} />
          </Field>
          <Field label="Αποδείξεις">
            <input inputMode="numeric" value={receiptCount} onChange={(e) => setReceiptCount(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} ${low("receipt_count")}`} />
          </Field>
        </div>
      </Section>

      <Section title="Εισπράξεις (€)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Σύνολο εισπράξεων *">
            <input inputMode="decimal" value={grossTotal} onChange={(e) => setGrossTotal(e.target.value)}
              className={`${inputCls} font-semibold ${low("gross_total")}`} />
          </Field>
          <Field label="Εκπτώσεις">
            <input inputMode="decimal" value={discounts} onChange={(e) => setDiscounts(e.target.value)}
              className={`${inputCls} ${low("discounts_total")}`} />
          </Field>
          <Field label="Μετρητά">
            <input inputMode="decimal" value={cashTotal} onChange={(e) => setCashTotal(e.target.value)}
              className={`${inputCls} ${low("cash_total")}`} />
          </Field>
          <Field label="Κάρτα">
            <input inputMode="decimal" value={cardTotal} onChange={(e) => setCardTotal(e.target.value)}
              className={`${inputCls} ${low("card_total")}`} />
          </Field>
          <Field label="Ακυρωμένες (ποσό)">
            <input inputMode="decimal" value={cancelledTotal} onChange={(e) => setCancelledTotal(e.target.value)}
              className={`${inputCls} ${low("cancelled_total")}`} />
          </Field>
          <Field label="Ακυρωμένες (πλήθος)">
            <input inputMode="numeric" value={cancelledCount} onChange={(e) => setCancelledCount(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} ${low("cancelled_count")}`} />
          </Field>
        </div>
      </Section>

      <Section
        title="ΦΠΑ ανά συντελεστή"
        action={
          <AddBtn onClick={() => setVatRows((r) => [...r, { vat_label: "", vat_rate: "", gross_amount: "", net_amount: "", vat_amount: "" }])} />
        }
      >
        {vatRows.length === 0 && <Empty>Δεν υπάρχουν γραμμές ΦΠΑ.</Empty>}
        <div className="space-y-2">
          {vatRows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input placeholder="Γ" value={row.vat_label} aria-label="Κατηγορία"
                onChange={(e) => updRow(setVatRows, i, "vat_label", e.target.value)} className={`${inputCls} w-10 text-center`} />
              <input placeholder="24" inputMode="decimal" value={row.vat_rate} aria-label="Συντελεστής %"
                onChange={(e) => updRow(setVatRows, i, "vat_rate", e.target.value)} className={`${inputCls} w-14 text-center`} />
              <input placeholder="Μικτά" inputMode="decimal" value={row.gross_amount} aria-label="Μικτά"
                onChange={(e) => updRow(setVatRows, i, "gross_amount", e.target.value)} className={`${inputCls} flex-1`} />
              <input placeholder="Καθαρά" inputMode="decimal" value={row.net_amount} aria-label="Καθαρά"
                onChange={(e) => updRow(setVatRows, i, "net_amount", e.target.value)} className={`${inputCls} flex-1`} />
              <input placeholder="ΦΠΑ" inputMode="decimal" value={row.vat_amount} aria-label="ΦΠΑ"
                onChange={(e) => updRow(setVatRows, i, "vat_amount", e.target.value)} className={`${inputCls} flex-1`} />
              <DelBtn onClick={() => setVatRows((r) => r.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Τμήματα"
        action={<AddBtn onClick={() => setDeptRows((r) => [...r, { name: "", amount: "", items: "" }])} />}
      >
        {deptRows.length === 0 && <Empty>Δεν υπάρχουν τμήματα.</Empty>}
        <div className="space-y-2">
          {deptRows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input placeholder="ΕΝΔΥΣΗ" value={row.name} aria-label="Τμήμα"
                onChange={(e) => updRow(setDeptRows, i, "name", e.target.value)} className={`${inputCls} flex-1`} />
              <input placeholder="Ποσό €" inputMode="decimal" value={row.amount} aria-label="Ποσό"
                onChange={(e) => updRow(setDeptRows, i, "amount", e.target.value)} className={`${inputCls} w-24`} />
              <input placeholder="Τεμ." inputMode="decimal" value={row.items} aria-label="Τεμάχια"
                onChange={(e) => updRow(setDeptRows, i, "items", e.target.value)} className={`${inputCls} w-16`} />
              <DelBtn onClick={() => setDeptRows((r) => r.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Λοιπά">
        <div className="space-y-3">
          <Field label="Αρ. Μητρώου ταμειακής">
            <input value={registerSerial} onChange={(e) => setRegisterSerial(e.target.value)}
              className={`${inputCls} ${low("register_serial")}`} />
          </Field>
          <Field label="Διαβίβαση ΑΑΔΕ">
            <select value={aade} onChange={(e) => setAade(e.target.value)} className={inputCls}>
              <option value="">Άγνωστο</option>
              <option value="1">✓ Επιτυχής (OK)</option>
              <option value="0">✗ Απέτυχε</option>
            </select>
          </Field>
          <Field label="Σημειώσεις">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
          </Field>
        </div>
      </Section>

      {extraction && extraction.warnings.length > 0 && (
        <div className="rounded-xl bg-black/5 px-4 py-3 text-xs text-[var(--ink-2)]">
          <p className="mb-1 font-semibold">Σημειώσεις εξαγωγής AI:</p>
          {extraction.warnings.map((w, i) => (
            <p key={i}>• {w}</p>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => submit(false)}
          disabled={busy || futureDate}
          className="flex-1 rounded-xl border border-black/15 bg-[var(--surface-1)] py-3.5 font-semibold disabled:opacity-50"
        >
          Αποθήκευση
        </button>
        <button
          onClick={() => submit(true)}
          disabled={busy || futureDate}
          className="flex-1 rounded-xl bg-[var(--series-1)] py-3.5 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Αποθήκευση…" : "✓ Επιβεβαίωση"}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-base";

function updRow<T>(set: Dispatch<SetStateAction<T[]>>, i: number, key: keyof T, value: string) {
  set((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-[var(--surface-1)] p-4 shadow-sm ring-1 ring-black/10">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--ink-2)]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg px-2 py-1 text-sm font-semibold text-[var(--series-1)]">
      + Προσθήκη
    </button>
  );
}

function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Διαγραφή γραμμής" className="px-1.5 py-1 text-[var(--ink-muted)]">
      ✕
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--ink-muted)]">{children}</p>;
}

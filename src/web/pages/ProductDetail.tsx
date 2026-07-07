import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { fmtEur, parseAmount } from "../format";
import type { ProductDetail as PD, ProductVariant } from "../../shared/types";

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState<PD | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.get<PD>(`/api/products/${id}`).then(setP).catch(() => setError("Δεν βρέθηκε το προϊόν."));
  };
  useEffect(load, [id]);

  if (error) return <p className="py-8 text-center text-sm text-[var(--delta-down)]">{error}</p>;
  if (!p) return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Φόρτωση…</p>;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="text-sm text-[var(--series-1)]">← Πίσω</button>

      <div className="flex gap-3">
        {p.image_url && <img src={p.image_url} alt="" className="h-24 w-24 rounded-xl object-cover" />}
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-snug">{p.name}</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {[p.manufacturer, p.mpn, p.category].filter(Boolean).join(" · ")}
          </p>
          {p.color && <p className="text-sm text-[var(--ink-2)]">Χρώμα: {p.color}</p>}
          <p className="text-xs text-[var(--ink-muted)]">ΦΠΑ {p.vat_rate}%{p.woo_id ? ` · e-shop #${p.woo_id}` : " · μόνο τοπικό"}</p>
        </div>
      </div>

      <h3 className="font-semibold">Μεγέθη / παραλλαγές</h3>
      <ul className="space-y-2">
        {p.variants.map((v) => (
          <VariantRow key={v.id} v={v} onChanged={load} />
        ))}
      </ul>
      {p.description && <p className="text-sm text-[var(--ink-2)]">{p.description}</p>}
    </div>
  );
}

function VariantRow({ v, onChanged }: { v: ProductVariant; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (successMsg) setMsg(successMsg);
      onChanged();
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "ean_taken" ? "Το barcode ανήκει ήδη σε άλλο προϊόν." : "Σφάλμα — δοκιμάστε ξανά.");
    } finally {
      setBusy(false);
    }
  };

  const editPrice = () => {
    const input = prompt("Νέα τιμή (€):", String(v.price));
    if (input == null) return;
    const price = parseAmount(input);
    if (price == null || price < 0) return alert("Μη έγκυρη τιμή.");
    act(() => api.put(`/api/products/variants/${v.id}`, { price }));
  };

  const editStock = () => {
    const input = prompt("Νέο απόθεμα (τεμάχια):", String(v.stock));
    if (input == null) return;
    const setTo = Number(input);
    if (!Number.isInteger(setTo)) return alert("Μη έγκυρος αριθμός.");
    act(() => api.post(`/api/products/variants/${v.id}/stock`, { set_to: setTo }));
  };

  const editEan = () => {
    const input = prompt("Barcode (EAN) — σκανάρετε ή πληκτρολογήστε:", v.ean ?? "");
    if (input == null || input.trim().length < 4) return;
    act(() => api.post(`/api/products/variants/${v.id}/ean`, { ean: input.trim() }), "Το barcode αποθηκεύτηκε.");
  };

  return (
    <li className="rounded-xl bg-[var(--surface-1)] p-3 ring-1 ring-black/10">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{[v.size, v.color].filter(Boolean).join(" · ") || "Ενιαίο"}</p>
          <p className="text-xs text-[var(--ink-muted)]">{v.ean ? `EAN ${v.ean}` : "χωρίς barcode"}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold">{fmtEur(v.price)}</p>
          <p className={`text-xs font-semibold ${v.stock > 0 ? "text-[var(--series-2)]" : "text-[var(--delta-down)]"}`}>
            στοκ {v.stock}
          </p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={editPrice} disabled={busy} className="flex-1 rounded-lg bg-black/5 py-1.5 text-xs font-semibold disabled:opacity-50">Τιμή</button>
        <button onClick={editStock} disabled={busy} className="flex-1 rounded-lg bg-black/5 py-1.5 text-xs font-semibold disabled:opacity-50">Απόθεμα</button>
        <button onClick={editEan} disabled={busy} className="flex-1 rounded-lg bg-black/5 py-1.5 text-xs font-semibold disabled:opacity-50">Barcode</button>
      </div>
      {msg && <p className="mt-1 text-xs text-[var(--ink-2)]">{msg}</p>}
    </li>
  );
}

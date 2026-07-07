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

      <div>
        <h2 className="text-lg font-bold leading-snug">{p.name}</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          {[p.manufacturer, p.mpn, p.category].filter(Boolean).join(" · ")}
        </p>
        {p.color && <p className="text-sm text-[var(--ink-2)]">Χρώμα: {p.color}</p>}
        <p className="text-xs text-[var(--ink-muted)]">ΦΠΑ {p.vat_rate}%{p.woo_id ? ` · e-shop #${p.woo_id}` : " · μόνο τοπικό"}</p>
      </div>

      <Gallery images={p.images.length > 0 ? p.images : p.image_url ? [p.image_url] : []} />

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

/** Horizontal swipe gallery with a tap-to-enlarge overlay. */
function Gallery({ images }: { images: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
        {images.map((url, i) => (
          <button key={url} onClick={() => setOpen(url)} className="shrink-0 snap-start">
            <img
              src={url}
              alt={`Φωτογραφία ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              className="h-56 w-44 rounded-xl object-cover ring-1 ring-black/10"
            />
          </button>
        ))}
      </div>
      {images.length > 1 && (
        <p className="-mt-2 text-center text-[11px] text-[var(--ink-muted)]">{images.length} φωτογραφίες — σύρετε δεξιά</p>
      )}
      {open && (
        <button
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3"
          aria-label="Κλείσιμο"
        >
          <img src={open} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </button>
      )}
    </>
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

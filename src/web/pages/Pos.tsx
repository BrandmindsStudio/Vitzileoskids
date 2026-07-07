import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { fmtEur } from "../format";
import type { LookupResult, PaymentMethod, Product, ProductDetail, SaleType, SalesDay } from "../../shared/types";

interface CartLine {
  variant_id: number;
  product_name: string;
  variant_label: string | null;
  unit_price: number;
  quantity: number;
}

export default function Pos() {
  const [mode, setMode] = useState<SaleType>("sale");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scan, setScan] = useState("");
  const [teach, setTeach] = useState<string | null>(null); // unknown barcode awaiting mapping
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ total: number; type: SaleType } | null>(null);
  const [day, setDay] = useState<SalesDay | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const loadDay = useCallback(() => {
    api.get<SalesDay>("/api/sales").then(setDay).catch(() => {});
  }, []);
  useEffect(loadDay, [loadDay]);

  // The USB/BT scanner types the code + Enter into this input; keep it focused.
  useEffect(() => {
    if (!teach && !done) scanRef.current?.focus();
  }, [teach, done, cart.length]);

  const addVariant = (r: LookupResult) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.variant_id === r.variant.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...c,
        {
          variant_id: r.variant.id,
          product_name: r.product.name,
          variant_label: [r.variant.size, r.variant.color].filter(Boolean).join(" · ") || null,
          unit_price: r.variant.price,
          quantity: 1,
        },
      ];
    });
    if (mode === "sale" && r.variant.stock <= 0) {
      setFlash(`⚠️ «${r.product.name}» έχει στοκ ${r.variant.stock} — η πώληση καταγράφεται κανονικά.`);
    }
  };

  const onScan = async (code: string) => {
    const trimmed = code.trim();
    setScan("");
    if (!trimmed) return;
    setFlash(null);
    try {
      const res = await api.get<{ match: LookupResult | null }>(`/api/products/lookup?code=${encodeURIComponent(trimmed)}`);
      if (res.match) addVariant(res.match);
      else setTeach(trimmed);
    } catch {
      setFlash("Σφάλμα αναζήτησης — δοκιμάστε ξανά.");
    }
  };

  const setQty = (i: number, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((_, j) => j !== i) : c.map((l, j) => (j === i ? { ...l, quantity: qty } : l))));

  const editLinePrice = (i: number) => {
    const input = prompt("Τιμή γραμμής (€):", String(cart[i].unit_price));
    if (input == null) return;
    const price = Number(input.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) return;
    setCart((c) => c.map((l, j) => (j === i ? { ...l, unit_price: price } : l)));
  };

  const total = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);

  const checkout = async (payment: PaymentMethod) => {
    if (cart.length === 0 || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      await api.post("/api/sales", {
        type: mode,
        payment_method: payment,
        notes: null,
        lines: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price })),
      });
      setDone({ total, type: mode });
      setCart([]);
      setMode("sale");
      loadDay();
    } catch {
      setFlash("Αποτυχία καταχώρησης — ελέγξτε τη σύνδεση και δοκιμάστε ξανά.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 pt-8 text-center">
        <p className="text-5xl">{done.type === "sale" ? "✅" : "↩️"}</p>
        <h2 className="text-xl font-bold">{done.type === "sale" ? "Η πώληση καταχωρήθηκε" : "Η επιστροφή καταχωρήθηκε"}</h2>
        <p className="text-3xl font-bold">{fmtEur(done.total)}</p>
        <p className="text-sm text-[var(--ink-muted)]">
          {done.type === "sale"
            ? "Μην ξεχάσεις την απόδειξη στην ταμειακή! 🧾"
            : "Τα τεμάχια επέστρεψαν στο απόθεμα."}
        </p>
        <button
          onClick={() => setDone(null)}
          className="w-full rounded-xl bg-[var(--series-1)] py-4 font-semibold text-white"
        >
          Επόμενη συναλλαγή
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          Ταμείο{" "}
          <Link to="/sales" className="align-middle text-xs font-semibold text-[var(--series-1)]">
            Ιστορικό →
          </Link>
        </h2>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-black/10">
          {(["sale", "return"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-sm font-semibold ${
                mode === m ? (m === "sale" ? "bg-[var(--series-1)] text-white" : "bg-[var(--delta-down)] text-white") : "bg-[var(--surface-1)] text-[var(--ink-2)]"
              }`}
            >
              {m === "sale" ? "Πώληση" : "Επιστροφή"}
            </button>
          ))}
        </div>
      </div>

      {day && (
        <p className="text-xs text-[var(--ink-muted)]">
          Σήμερα: {day.totals.count} πωλήσεις · {fmtEur(day.totals.total)} (μετρητά {fmtEur(day.totals.cash)} / κάρτα {fmtEur(day.totals.card)})
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onScan(scan);
        }}
      >
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder={mode === "sale" ? "Σκανάρετε barcode ή γράψτε κωδικό…" : "Σκανάρετε το προϊόν που επιστρέφεται…"}
          autoComplete="off"
          className={`w-full rounded-xl border-2 px-3 py-3 text-lg ${
            mode === "sale" ? "border-[var(--series-1)]" : "border-[var(--delta-down)]"
          } bg-[var(--surface-1)]`}
        />
      </form>

      {flash && <p className="text-sm font-semibold text-[var(--delta-down)]">{flash}</p>}

      {cart.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">
          Το καλάθι είναι άδειο — σκανάρετε ένα προϊόν.
          {mode === "return" && <span className="mt-1 block font-semibold text-[var(--delta-down)]">Λειτουργία ΕΠΙΣΤΡΟΦΗΣ: το στοκ θα αυξηθεί.</span>}
        </p>
      ) : (
        <ul className="space-y-2">
          {cart.map((l, i) => (
            <li key={l.variant_id} className="rounded-xl bg-[var(--surface-1)] p-3 ring-1 ring-black/10">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{l.product_name}</p>
                  {l.variant_label && <p className="text-xs text-[var(--ink-muted)]">{l.variant_label}</p>}
                </div>
                <button onClick={() => editLinePrice(i)} className="shrink-0 font-semibold underline decoration-dotted">
                  {fmtEur(l.unit_price)}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => setQty(i, l.quantity - 1)} className="h-8 w-8 rounded-lg bg-black/5 font-bold">−</button>
                  <span className="w-6 text-center font-semibold">{l.quantity}</span>
                  <button onClick={() => setQty(i, l.quantity + 1)} className="h-8 w-8 rounded-lg bg-black/5 font-bold">+</button>
                </div>
                <p className="font-semibold">{fmtEur(l.unit_price * l.quantity)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cart.length > 0 && (
        <>
          <div className="flex items-center justify-between rounded-xl bg-[var(--surface-1)] p-3 text-lg font-bold ring-1 ring-black/10">
            <span>{mode === "sale" ? "Σύνολο" : "Επιστροφή"}</span>
            <span>{fmtEur(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => checkout("cash")}
              disabled={busy}
              className="rounded-xl bg-[var(--series-2)] py-4 font-semibold text-white disabled:opacity-50"
            >
              💶 Μετρητά
            </button>
            <button
              onClick={() => checkout("card")}
              disabled={busy}
              className="rounded-xl bg-[var(--series-1)] py-4 font-semibold text-white disabled:opacity-50"
            >
              💳 Κάρτα
            </button>
          </div>
          {mode === "sale" && (
            <p className="text-center text-xs text-[var(--ink-muted)]">Η απόδειξη κόβεται στην ταμειακή, όπως πάντα.</p>
          )}
        </>
      )}

      {teach && <TeachDialog code={teach} onDone={(r) => { setTeach(null); if (r) addVariant(r); }} />}
    </div>
  );
}

/** Unknown barcode: find the product, pick the size, save the mapping forever. */
function TeachDialog({ code, onDone }: { code: string; onDone: (added: LookupResult | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [selected, setSelected] = useState<ProductDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const search = (value: string) => {
    setQ(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (!value.trim()) return setResults([]);
      try {
        const res = await api.get<{ products: Product[] }>(`/api/products?q=${encodeURIComponent(value.trim().toLowerCase())}`);
        setResults(res.products.slice(0, 8));
      } catch { /* keep previous results */ }
    }, 250);
  };

  const pick = async (id: number) => {
    setSelected(await api.get<ProductDetail>(`/api/products/${id}`));
  };

  const assign = async (variantId: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/products/variants/${variantId}/ean`, { ean: code });
      const res = await api.get<{ match: LookupResult | null }>(`/api/products/lookup?code=${encodeURIComponent(code)}`);
      onDone(res.match);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "ean_taken" ? "Αυτό το barcode ανήκει ήδη σε άλλο μέγεθος." : "Σφάλμα — δοκιμάστε ξανά.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-[var(--surface-1)] p-4">
        <h3 className="font-bold">Άγνωστο barcode</h3>
        <p className="text-sm text-[var(--ink-2)]">
          Το <span className="font-mono font-semibold">{code}</span> δεν υπάρχει ακόμα. Βρες το προϊόν και διάλεξε μέγεθος —
          θα το θυμάται για πάντα.
        </p>

        {!selected ? (
          <>
            <input
              autoFocus
              value={q}
              onChange={(e) => search(e.target.value)}
              placeholder="Όνομα ή κωδικός προϊόντος…"
              className="w-full rounded-xl border border-black/15 px-3 py-2.5"
            />
            <ul className="space-y-1.5">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => pick(p.id)} className="flex w-full items-center gap-2 rounded-lg bg-black/5 p-2 text-left">
                    {p.image_url && <img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-[var(--ink-muted)]">{[p.manufacturer, p.mpn].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold">{selected.name}</p>
            <div className="grid grid-cols-3 gap-2">
              {selected.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => assign(v.id)}
                  disabled={busy}
                  className="rounded-lg bg-black/5 px-2 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {[v.size, v.color].filter(Boolean).join(" · ") || "Ενιαίο"}
                  {v.ean && <span className="block text-[10px] font-normal text-[var(--ink-muted)]">έχει ήδη barcode</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setSelected(null)} className="text-sm text-[var(--series-1)]">← Άλλο προϊόν</button>
          </>
        )}

        {error && <p className="text-sm text-[var(--delta-down)]">{error}</p>}
        <button onClick={() => onDone(null)} className="w-full rounded-xl bg-black/5 py-2.5 text-sm font-semibold">
          Ακύρωση
        </button>
      </div>
    </div>
  );
}

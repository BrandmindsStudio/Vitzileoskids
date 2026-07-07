import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fmtEur } from "../format";
import type { Product } from "../../shared/types";

export default function Products() {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [inStock, setInStock] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const load = async (query: string, stockOnly: boolean, off: number, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (stockOnly) params.set("in_stock", "1");
      params.set("offset", String(off));
      const res = await api.get<{ products: Product[]; has_more: boolean }>(`/api/products?${params}`);
      setItems((prev) => (append ? [...prev, ...res.products] : res.products));
      setHasMore(res.has_more);
      setOffset(off + res.products.length);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("", false, 0, false);
  }, []);

  const onSearch = (value: string) => {
    setQ(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(value, inStock, 0, false), 300);
  };

  const onToggleStock = (v: boolean) => {
    setInStock(v);
    load(q, v, 0, false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Προϊόντα</h2>
        <div className="flex gap-2">
          <Link to="/products/new" className="rounded-lg bg-[var(--surface-1)] px-3 py-2 text-sm font-semibold ring-1 ring-black/10">
            + Νέο
          </Link>
          <Link to="/products/feed" className="rounded-lg bg-[var(--series-1)] px-3 py-2 text-sm font-semibold text-white">
            ⟳ Συγχρονισμός
          </Link>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Αναζήτηση: όνομα, κωδικός, barcode…"
          className="w-full rounded-xl border border-black/15 bg-[var(--surface-1)] px-3 py-2.5"
        />
        <button
          onClick={() => onToggleStock(!inStock)}
          className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-black/10 ${
            inStock ? "bg-[var(--series-1)] text-white" : "bg-[var(--surface-1)] text-[var(--ink-2)]"
          }`}
        >
          Σε στοκ
        </button>
      </div>

      {items.length === 0 && !loading && (
        <p className="py-8 text-center text-sm text-[var(--ink-muted)]">
          Δεν υπάρχουν προϊόντα ακόμα — πάτησε «⟳ Συγχρονισμός» για εισαγωγή από το e-shop.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id}>
            <Link
              to={`/products/${p.id}`}
              className="flex items-center gap-3 rounded-xl bg-[var(--surface-1)] p-2.5 ring-1 ring-black/10"
            >
              {p.image_url ? (
                <img src={p.image_url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-black/5 text-xl">👕</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="truncate text-xs text-[var(--ink-muted)]">
                  {[p.manufacturer, p.mpn, p.category].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold">
                  {p.min_price != null && (p.min_price === p.max_price ? fmtEur(p.min_price) : `${fmtEur(p.min_price)}+`)}
                </p>
                <p className={`text-xs font-semibold ${p.total_stock > 0 ? "text-[var(--series-2)]" : "text-[var(--delta-down)]"}`}>
                  στοκ {p.total_stock}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          onClick={() => load(q, inStock, offset, true)}
          disabled={loading}
          className="w-full rounded-xl bg-[var(--surface-1)] py-3 text-sm font-semibold ring-1 ring-black/10 disabled:opacity-50"
        >
          Περισσότερα…
        </button>
      )}
    </div>
  );
}

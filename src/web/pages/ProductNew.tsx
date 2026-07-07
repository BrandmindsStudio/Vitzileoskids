import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { parseAmount } from "../format";

interface VariantDraft {
  size: string;
  ean: string;
  price: string;
  stock: string;
}

export default function ProductNew() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [mpn, setMpn] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([{ size: "", ean: "", price: "", stock: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setV = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError("Το όνομα είναι υποχρεωτικό.");
    const parsed = [];
    for (const v of variants) {
      const price = parseAmount(v.price);
      const stock = Number(v.stock || "0");
      if (price == null || price < 0) return setError("Συμπλήρωσε έγκυρη τιμή σε όλα τα μεγέθη.");
      if (!Number.isInteger(stock)) return setError("Μη έγκυρο απόθεμα.");
      parsed.push({
        size: v.size.trim() || null,
        color: null,
        ean: v.ean.trim() || null,
        price,
        stock,
      });
    }
    setBusy(true);
    try {
      const res = await api.post<{ id: number }>("/api/products", {
        name: name.trim(),
        mpn: mpn.trim() || null,
        manufacturer: manufacturer.trim() || null,
        category: category.trim() || null,
        color: color.trim() || null,
        vat_rate: 24,
        variants: parsed,
      });
      navigate(`/products/${res.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "ean_taken" ? "Κάποιο barcode χρησιμοποιείται ήδη." : "Σφάλμα αποθήκευσης.");
      setBusy(false);
    }
  };

  const input = "w-full rounded-xl border border-black/15 bg-[var(--surface-1)] px-3 py-2.5";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Νέο προϊόν</h2>

      <input className={input} placeholder="Όνομα *" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="Κωδικός (mpn)" value={mpn} onChange={(e) => setMpn(e.target.value)} />
        <input className={input} placeholder="Μάρκα" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        <input className={input} placeholder="Κατηγορία" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className={input} placeholder="Χρώμα" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>

      <h3 className="font-semibold">Μεγέθη</h3>
      {variants.map((v, i) => (
        <div key={i} className="grid grid-cols-4 gap-2">
          <input className={input} placeholder="Μέγεθος" value={v.size} onChange={(e) => setV(i, { size: e.target.value })} />
          <input className={input} placeholder="Barcode" value={v.ean} onChange={(e) => setV(i, { ean: e.target.value })} />
          <input className={input} placeholder="Τιμή €" inputMode="decimal" value={v.price} onChange={(e) => setV(i, { price: e.target.value })} />
          <input className={input} placeholder="Τεμ." inputMode="numeric" value={v.stock} onChange={(e) => setV(i, { stock: e.target.value })} />
        </div>
      ))}
      <button
        onClick={() => setVariants((vs) => [...vs, { size: "", ean: "", price: variants[0]?.price ?? "", stock: "1" }])}
        className="w-full rounded-xl bg-[var(--surface-1)] py-2 text-sm font-semibold ring-1 ring-black/10"
      >
        + Μέγεθος
      </button>

      {error && <p className="text-sm text-[var(--delta-down)]">{error}</p>}

      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-xl bg-[var(--series-1)] py-4 font-semibold text-white disabled:opacity-50"
      >
        Αποθήκευση
      </button>
    </div>
  );
}

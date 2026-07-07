import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { fmtNum } from "../format";
import { parseFeedXml } from "../importXml";
import type { FeedStatus } from "../../shared/types";

const CHUNK = 40;
const FRESH_HOURS = 26; // once-a-day sync + margin

type RunState =
  | { phase: "idle" }
  | { phase: "fetching" }
  | { phase: "running"; done: number; total: number }
  | { phase: "done"; products: number; variants: number }
  | { phase: "error"; message: string };

/** SQLite UTC timestamp → Athens-local display string. */
function fmtUtc(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts.replace(" ", "T") + (ts.endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("el-GR", { timeZone: "Europe/Athens", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function hoursSince(ts: string): number {
  return (Date.now() - new Date(ts.replace(" ", "T") + "Z").getTime()) / 3_600_000;
}

export default function FeedSync() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [url, setUrl] = useState("");
  const [urlSaved, setUrlSaved] = useState(false);
  const [updateStock, setUpdateStock] = useState(true);
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api.get<FeedStatus>("/api/products/feed-status").then((s) => {
      setStatus(s);
      setUrl(s.feed_url ?? "");
    }).catch(() => {});
  };
  useEffect(load, []);

  const saveUrl = async () => {
    setUrlSaved(false);
    try {
      await api.put("/api/products/feed-url", { url: url.trim() });
      setUrlSaved(true);
      load();
    } catch {
      setRun({ phase: "error", message: "Το URL πρέπει να ξεκινά με https://" });
    }
  };

  const importXmlText = async (xml: string, source: "file" | "url", filename: string | null) => {
    const feed = parseFeedXml(xml);
    if (feed.products.length === 0) throw new Error("Δεν βρέθηκαν προϊόντα στο αρχείο.");
    setRun({ phase: "running", done: 0, total: feed.products.length });
    let importId: number | null = null;
    let totalP = 0;
    let totalV = 0;
    for (let i = 0; i < feed.products.length; i += CHUNK) {
      const res: { import_id: number; products: number; variants: number } = await api.post("/api/products/import", {
        update_stock: updateStock,
        import_id: importId,
        filename,
        source,
        feed_created_at: feed.created_at,
        products: feed.products.slice(i, i + CHUNK),
      });
      importId = res.import_id;
      totalP += res.products;
      totalV += res.variants;
      setRun({ phase: "running", done: Math.min(i + CHUNK, feed.products.length), total: feed.products.length });
    }
    setRun({ phase: "done", products: totalP, variants: totalV });
    load();
  };

  const syncFromUrl = async () => {
    setRun({ phase: "fetching" });
    try {
      const res = await fetch("/api/products/feed-proxy", { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error === "no_feed_url"
            ? "Δεν έχει οριστεί URL feed."
            : "Το e-shop δεν επέστρεψε το feed (μπλοκάρει ή είναι εκτός λειτουργίας).",
        );
      }
      await importXmlText(await res.text(), "url", null);
    } catch (e) {
      setRun({ phase: "error", message: e instanceof Error && e.message !== "invalid_xml" ? e.message : "Μη έγκυρο XML από το feed." });
    }
  };

  const syncFromFile = async (file: File) => {
    setRun({ phase: "fetching" });
    try {
      await importXmlText(await file.text(), "file", file.name);
    } catch (e) {
      setRun({ phase: "error", message: e instanceof Error && e.message !== "invalid_xml" ? e.message : "Μη έγκυρο αρχείο XML." });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const li = status?.last_import ?? null;
  const ageH = li ? hoursSince(li.created_at) : null;
  const verdict: { dot: string; label: string } = !li
    ? { dot: "🔴", label: "Δεν έχει γίνει ποτέ συγχρονισμός" }
    : ageH! <= FRESH_HOURS
      ? { dot: "🟢", label: "Ενημερωμένο" }
      : { dot: "🟡", label: `Παλιό — τελευταία ενημέρωση πριν ${Math.round(ageH!)} ώρες` };

  const busy = run.phase === "fetching" || run.phase === "running";

  return (
    <div className="space-y-4">
      <button onClick={() => navigate("/products")} className="text-sm text-[var(--series-1)]">← Προϊόντα</button>
      <h2 className="text-xl font-bold">Συγχρονισμός e-shop</h2>

      {/* Status */}
      <section className="space-y-2 rounded-2xl bg-[var(--surface-1)] p-4 ring-1 ring-black/10">
        <p className="text-base font-bold">{verdict.dot} {verdict.label}</p>
        {li && (
          <dl className="space-y-1 text-sm text-[var(--ink-2)]">
            <Row k="Τελευταίος συγχρονισμός" v={`${fmtUtc(li.created_at)} (${li.source === "url" ? "από το e-shop" : `αρχείο${li.filename ? `: ${li.filename}` : ""}`})`} />
            <Row k="Το feed δημιουργήθηκε" v={li.feed_created_at ?? "—"} />
            <Row k="Ενημερώθηκαν" v={`${fmtNum(li.products_upserted)} προϊόντα / ${fmtNum(li.variants_upserted)} μεγέθη`} />
          </dl>
        )}
        {status && (
          <dl className="space-y-1 border-t border-[var(--grid)] pt-2 text-sm text-[var(--ink-2)]">
            <Row k="Προϊόντα στο σύστημα" v={fmtNum(status.totals.products)} />
            <Row k="Μεγέθη/παραλλαγές" v={fmtNum(status.totals.variants)} />
            <Row
              k="Με barcode"
              v={`${fmtNum(status.totals.with_ean)} (${status.totals.variants ? Math.round((status.totals.with_ean / status.totals.variants) * 100) : 0}%)`}
            />
          </dl>
        )}
      </section>

      {/* Feed URL */}
      <section className="space-y-2 rounded-2xl bg-[var(--surface-1)] p-4 ring-1 ring-black/10">
        <h3 className="text-sm font-semibold">URL του XML feed</h3>
        <p className="text-xs text-[var(--ink-muted)]">
          Το link που παράγει το e-shop το XML (ρώτησε τον developer του site — συνήθως τελειώνει σε .xml ή ?feed=…).
          Μόλις οριστεί, ο συγχρονισμός γίνεται με ένα κουμπί, χωρίς κατέβασμα αρχείου.
        </p>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlSaved(false); }}
            placeholder="https://vitzileoskids.gr/…"
            className="w-full rounded-xl border border-black/15 px-3 py-2 text-sm"
          />
          <button onClick={saveUrl} className="shrink-0 rounded-xl bg-[var(--surface-1)] px-3 py-2 text-sm font-semibold ring-1 ring-black/10">
            {urlSaved ? "✓" : "Αποθήκευση"}
          </button>
        </div>
      </section>

      {/* Actions */}
      <label className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
        <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} />
        Ενημέρωση αποθέματος από το feed (όχι μόνο τιμές/εικόνες)
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={syncFromUrl}
          disabled={busy || !status?.feed_url}
          className="rounded-xl bg-[var(--series-1)] py-3.5 font-semibold text-white disabled:opacity-40"
        >
          ⟳ Συγχρονισμός τώρα
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-xl bg-[var(--surface-1)] py-3.5 font-semibold ring-1 ring-black/10 disabled:opacity-40"
        >
          📄 Ανέβασμα αρχείου
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".xml,text/xml" hidden onChange={(e) => e.target.files?.[0] && syncFromFile(e.target.files[0])} />

      {run.phase === "fetching" && <p className="text-sm text-[var(--ink-muted)]">Λήψη feed…</p>}
      {run.phase === "running" && (
        <div className="rounded-xl bg-[var(--surface-1)] p-3 text-sm ring-1 ring-black/10">
          Εισαγωγή… {run.done}/{run.total} προϊόντα
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-[var(--series-1)] transition-all" style={{ width: `${(run.done / run.total) * 100}%` }} />
          </div>
        </div>
      )}
      {run.phase === "done" && (
        <p className="rounded-xl bg-[var(--surface-1)] p-3 text-sm text-[var(--series-2)] ring-1 ring-black/10">
          ✓ Ολοκληρώθηκε: {fmtNum(run.products)} προϊόντα, {fmtNum(run.variants)} μεγέθη.
        </p>
      )}
      {run.phase === "error" && <p className="text-sm text-[var(--delta-down)]">{run.message}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--ink-muted)]">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

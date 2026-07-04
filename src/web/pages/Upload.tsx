import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { compressPhoto } from "../compress";

const MAX_PHOTOS = 8;

type Phase = "pick" | "uploading" | "extracting";

export default function Upload() {
  const [photos, setPhotos] = useState<{ file: Blob; url: string }[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const incoming = [...list].slice(0, MAX_PHOTOS - photos.length);
    try {
      const compressed = await Promise.all(
        incoming.map(async (f) => {
          const blob = await compressPhoto(f);
          return { file: blob, url: URL.createObjectURL(blob) };
        }),
      );
      setPhotos((p) => [...p, ...compressed]);
    } catch {
      setError("Αποτυχία επεξεργασίας φωτογραφίας. Δοκιμάστε ξανά.");
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const move = (i: number, dir: -1 | 1) => {
    setPhotos((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const copy = [...p];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const remove = (i: number) => setPhotos((p) => p.filter((_, j) => j !== i));

  const upload = async () => {
    setError(null);
    setPhase("uploading");
    let reportId: number | null = null;
    try {
      const form = new FormData();
      photos.forEach((p, i) => form.append("photos", p.file, `photo-${i}.jpg`));
      const created = await api.postForm<{ id: number }>("/api/reports/photos", form);
      reportId = created.id;
    } catch {
      setPhase("pick");
      setError("Αποτυχία ανεβάσματος. Ελέγξτε τη σύνδεση και δοκιμάστε ξανά.");
      return;
    }

    // Photos are safely stored from this point — extraction failure never loses them.
    setPhase("extracting");
    try {
      await api.post(`/api/reports/${reportId}/extract`);
      navigate(`/reports/${reportId}?review=1`);
    } catch {
      navigate(`/reports/${reportId}?review=1&extraction_failed=1`);
    }
  };

  const busy = phase !== "pick";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Φωτογραφία δελτίου «Ζ»</h2>
      <p className="text-sm text-[var(--ink-2)]">
        Η ταινία είναι μακριά — τραβήξτε <strong>2–4 φωτογραφίες με επικάλυψη</strong>, από πάνω προς τα
        κάτω, ώστε να φαίνεται όλο το δελτίο.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((p, i) => (
            <li key={p.url} className="relative overflow-hidden rounded-xl ring-1 ring-black/10">
              <img src={p.url} alt={`Φωτογραφία ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
              <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                {i + 1}
              </span>
              <div className="absolute bottom-0 inset-x-0 flex justify-between bg-black/50 px-1 py-1 text-white">
                <button onClick={() => move(i, -1)} disabled={i === 0 || busy} className="px-2 disabled:opacity-30" aria-label="Πάνω">↑</button>
                <button onClick={() => remove(i)} disabled={busy} className="px-2" aria-label="Διαγραφή">🗑</button>
                <button onClick={() => move(i, 1)} disabled={i === photos.length - 1 || busy} className="px-2 disabled:opacity-30" aria-label="Κάτω">↓</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {photos.length < MAX_PHOTOS && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full rounded-2xl border-2 border-dashed border-black/20 bg-[var(--surface-1)] py-8 text-center text-[var(--ink-2)] disabled:opacity-50"
        >
          <span className="block text-3xl">📷</span>
          <span className="mt-1 block font-semibold">
            {photos.length === 0 ? "Λήψη / επιλογή φωτογραφιών" : "Προσθήκη φωτογραφίας"}
          </span>
          <span className="mt-0.5 block text-xs">{photos.length}/{MAX_PHOTOS}</span>
        </button>
      )}

      {error && <p className="text-sm text-[var(--delta-down)]">{error}</p>}

      <button
        onClick={upload}
        disabled={photos.length === 0 || busy}
        className="w-full rounded-xl bg-[var(--series-1)] py-4 text-base font-semibold text-white disabled:opacity-50"
      >
        {phase === "uploading" && "Ανέβασμα φωτογραφιών…"}
        {phase === "extracting" && "Ανάγνωση δελτίου με AI…"}
        {phase === "pick" && `Ανέβασμα & ανάγνωση (${photos.length})`}
      </button>

      {phase === "extracting" && (
        <p className="text-center text-sm text-[var(--ink-muted)]">Συνήθως διαρκεί 10–30 δευτερόλεπτα…</p>
      )}
    </div>
  );
}

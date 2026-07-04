import { useState } from "react";

/**
 * Photo strip for the review/detail screen. Tap a thumbnail to open it
 * full-screen; the overlay is scrollable and the image can be toggled
 * between fit and 2.5× zoom (plus native pinch-zoom on the scroll area).
 */
export default function PhotoViewer({ photos }: { photos: { id: number }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((p, i) => (
          <button
            key={p.id}
            onClick={() => {
              setOpen(p.id);
              setZoom(false);
            }}
            className="shrink-0 overflow-hidden rounded-xl ring-1 ring-black/10"
            aria-label={`Φωτογραφία ${i + 1}`}
          >
            <img src={`/api/photos/${p.id}`} alt={`Ζ — μέρος ${i + 1}`} className="h-40 w-28 object-cover" loading="lazy" />
          </button>
        ))}
      </div>

      {open !== null && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/95" onClick={() => setOpen(null)}>
          <button
            className="fixed right-4 top-4 z-10 rounded-full bg-white/20 px-3 py-1.5 text-lg text-white"
            onClick={() => setOpen(null)}
            aria-label="Κλείσιμο"
          >
            ✕
          </button>
          <img
            src={`/api/photos/${open}`}
            alt="Δελτίο Ζ"
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => !z);
            }}
            className="mx-auto my-8 cursor-zoom-in"
            style={{ width: zoom ? "250%" : "100%", maxWidth: zoom ? "none" : "48rem" }}
          />
        </div>
      )}
    </>
  );
}

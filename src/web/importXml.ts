// Parses the e-shop "mywebstore" product feed XML (vitzileoskids.gr export)
// into ImportProduct rows for POST /api/products/import.
import type { ImportProduct } from "../shared/types";

function text(el: Element, tag: string): string | null {
  const t = el.querySelector(`:scope > ${tag}`)?.textContent?.trim();
  return t ? t : null;
}

function num(el: Element, tag: string): number | null {
  const t = text(el, tag);
  if (t == null) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseFeedXml(xml: string): ImportProduct[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("invalid_xml");

  const out: ImportProduct[] = [];
  const seenEans = new Set<string>();

  for (const p of doc.querySelectorAll("products > product")) {
    const wooId = num(p, "id");
    const name = text(p, "name");
    if (wooId == null || !name) continue;

    const base = {
      woo_id: wooId,
      mpn: text(p, "mpn"),
      name,
      category: text(p, "category"),
      manufacturer: text(p, "manufacturer"),
      color: text(p, "color"),
      image_url: text(p, "image"),
      link: text(p, "link"),
      description: text(p, "description"),
      vat_rate: num(p, "vat") ?? 24,
    };
    const basePrice = num(p, "price_with_vat") ?? 0;

    const variants: ImportProduct["variants"] = [];
    for (const v of p.querySelectorAll(":scope > variations > variation")) {
      const vid = num(v, "id");
      let ean = text(v, "ean");
      // The unique index on ean requires feed-level dedup (rare data-entry slips).
      if (ean && seenEans.has(ean)) ean = null;
      if (ean) seenEans.add(ean);
      variants.push({
        woo_variation_id: vid,
        ean,
        size: text(v, "size"),
        color: text(v, "color"),
        price: num(v, "price_with_vat") ?? basePrice,
        stock: num(v, "quantity") ?? 0,
      });
    }
    if (variants.length === 0) {
      // Simple product without a variations block: one variant from the product fields.
      variants.push({
        woo_variation_id: null,
        ean: null,
        size: text(p, "size"),
        color: text(p, "color"),
        price: basePrice,
        stock: num(p, "quantity") ?? 0,
      });
    }
    out.push({ ...base, variants });
  }
  return out;
}

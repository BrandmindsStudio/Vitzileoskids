import { z } from "zod";

// Schema for the JSON returned by the extraction model. Strict enough to catch
// malformed output, lenient enough to accept nulls for unreadable fields.

const numOrNull = z.number().finite().nullable();
const intOrNull = z.number().int().nullable();

export const VatLineSchema = z.object({
  vat_label: z.string(),
  vat_rate: z.number().finite(),
  gross_amount: numOrNull,
  net_amount: numOrNull,
  vat_amount: numOrNull,
});

export const DepartmentSchema = z.object({
  name: z.string(),
  amount: numOrNull,
  items: numOrNull,
});

export const ExtractionSchema = z.object({
  business_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "business_date must be YYYY-MM-DD")
    .nullable(),
  z_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "z_time must be HH:MM")
    .nullable(),
  z_number: intOrNull,
  gross_total: numOrNull,
  receipt_count: intOrNull,
  cash_total: numOrNull,
  card_total: numOrNull,
  discounts_total: numOrNull,
  cancelled_total: numOrNull,
  cancelled_count: intOrNull,
  register_serial: z.string().nullable(),
  aade_transmitted: z.boolean().nullable(),
  vat_lines: z.array(VatLineSchema),
  departments: z.array(DepartmentSchema),
  confidence: z.record(z.enum(["high", "low"])).default({}),
  warnings: z.array(z.string()).default([]),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/** Parse the raw model output (may be wrapped in a code fence) into a validated Extraction. */
export function parseExtraction(raw: string): Extraction {
  let text = raw.trim();
  // Strip a possible ```json ... ``` fence.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  // Fall back to the outermost JSON object if the model added prose around it.
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in extraction output");
    text = text.slice(start, end + 1);
  }
  return ExtractionSchema.parse(JSON.parse(text));
}

/** Cross-check tolerance used by the review-screen validations (soft warnings, never blocking). */
export const TOLERANCE = 0.05;

export interface CrossCheck {
  key: string;
  ok: boolean;
  expected: number;
  actual: number;
}

/** The three soft validations from the spec. Missing inputs are skipped (treated as ok). */
export function crossChecks(e: {
  gross_total: number | null;
  cash_total: number | null;
  card_total: number | null;
  vat_lines: { gross_amount: number | null }[];
  departments: { amount: number | null }[];
}): CrossCheck[] {
  const out: CrossCheck[] = [];
  const gross = e.gross_total;
  if (gross != null) {
    if (e.cash_total != null && e.card_total != null) {
      const sum = e.cash_total + e.card_total;
      out.push({ key: "cash_plus_card", ok: Math.abs(sum - gross) <= TOLERANCE, expected: gross, actual: round2(sum) });
    }
    if (e.vat_lines.length > 0) {
      const sum = e.vat_lines.reduce((a, l) => a + (l.gross_amount ?? 0), 0);
      out.push({ key: "vat_sum", ok: Math.abs(sum - gross) <= TOLERANCE, expected: gross, actual: round2(sum) });
    }
    if (e.departments.length > 0) {
      const sum = e.departments.reduce((a, d) => a + (d.amount ?? 0), 0);
      out.push({ key: "department_sum", ok: Math.abs(sum - gross) <= TOLERANCE, expected: gross, actual: round2(sum) });
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

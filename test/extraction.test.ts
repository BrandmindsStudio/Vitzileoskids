import { describe, it, expect } from "vitest";
import { parseExtraction, ExtractionSchema, crossChecks } from "../src/extraction/schema";
import fixture from "./fixtures/z-report-908.json";

// Ground truth from a real Z-report (3i register, ΑΡ. ΜΗΤΡΩΟΥ DSN 23004085, Z 908).

describe("extraction schema", () => {
  it("validates the real-report fixture end-to-end", () => {
    const parsed = ExtractionSchema.parse({ ...fixture, confidence: {}, warnings: [] });
    expect(parsed.business_date).toBe("2026-07-03");
    expect(parsed.z_time).toBe("21:04");
    expect(parsed.z_number).toBe(908);
    expect(parsed.gross_total).toBe(840.9);
    expect(parsed.receipt_count).toBe(19);
    expect(parsed.cash_total).toBe(86.4);
    expect(parsed.card_total).toBe(754.5);
    expect(parsed.discounts_total).toBe(0);
    expect(parsed.cancelled_total).toBe(235);
    expect(parsed.cancelled_count).toBe(2);
    expect(parsed.register_serial).toBe("DSN 23004085");
    expect(parsed.aade_transmitted).toBe(true);
    expect(parsed.vat_lines).toHaveLength(5);
    expect(parsed.departments).toHaveLength(3);
  });

  it("parses raw model output wrapped in a code fence", () => {
    const raw = "```json\n" + JSON.stringify({ ...fixture, confidence: {}, warnings: [] }) + "\n```";
    const parsed = parseExtraction(raw);
    expect(parsed.z_number).toBe(908);
  });

  it("parses model output with surrounding prose", () => {
    const raw = "Here is the extraction:\n" + JSON.stringify({ ...fixture, confidence: {}, warnings: [] });
    expect(parseExtraction(raw).gross_total).toBe(840.9);
  });

  it("rejects malformed dates", () => {
    expect(() =>
      ExtractionSchema.parse({ ...fixture, business_date: "03-07-2026", confidence: {}, warnings: [] }),
    ).toThrow();
  });

  it("keeps the Ε 0% line with null net/vat amounts", () => {
    const parsed = ExtractionSchema.parse({ ...fixture, confidence: {}, warnings: [] });
    const zero = parsed.vat_lines.find((l) => l.vat_label === "Ε")!;
    expect(zero.vat_rate).toBe(0);
    expect(zero.net_amount).toBeNull();
    expect(zero.vat_amount).toBeNull();
  });
});

describe("review cross-checks (soft validations)", () => {
  it("all three checks pass on the real fixture", () => {
    const checks = crossChecks(fixture);
    expect(checks).toHaveLength(3);
    // cash 86.40 + card 754.50 = 840.90 ✓; VAT gross sum = 840.90 ✓; dept sum 476.55+312.95+51.40 = 840.90 ✓
    for (const check of checks) expect(check.ok).toBe(true);
  });

  it("flags a mismatch beyond the ±0.05 tolerance without blocking", () => {
    const checks = crossChecks({ ...fixture, cash_total: 80.0 });
    const cashCheck = checks.find((c) => c.key === "cash_plus_card")!;
    expect(cashCheck.ok).toBe(false);
    expect(cashCheck.actual).toBe(834.5);
  });

  it("accepts differences within tolerance", () => {
    const checks = crossChecks({ ...fixture, cash_total: 86.44 });
    expect(checks.find((c) => c.key === "cash_plus_card")!.ok).toBe(true);
  });
});

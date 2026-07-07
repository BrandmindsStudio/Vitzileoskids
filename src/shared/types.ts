// Types shared between the Worker API and the React SPA.

export type ReportSource = "photo" | "manual" | "mydata";
export type ReportStatus = "pending_review" | "confirmed";

export interface VatLine {
  vat_label: string;
  vat_rate: number;
  gross_amount: number | null;
  net_amount: number | null;
  vat_amount: number | null;
}

export interface DepartmentLine {
  name: string;
  amount: number | null;
  items: number | null;
}

export interface ZReport {
  id: number;
  business_date: string; // YYYY-MM-DD
  z_time: string | null;
  z_number: number;
  gross_total: number;
  receipt_count: number;
  cash_total: number | null;
  card_total: number | null;
  discounts_total: number | null;
  cancelled_total: number | null;
  cancelled_count: number | null;
  register_serial: string | null;
  aade_transmitted: number | null; // 1 / 0 / null
  source: ReportSource;
  status: ReportStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZReportDetail extends ZReport {
  vat_lines: VatLine[];
  departments: DepartmentLine[];
  photos: { id: number; order_index: number }[];
  extraction_json: string | null;
}

export interface ExtractionResult {
  business_date: string | null;
  z_time: string | null;
  z_number: number | null;
  gross_total: number | null;
  receipt_count: number | null;
  cash_total: number | null;
  card_total: number | null;
  discounts_total: number | null;
  cancelled_total: number | null;
  cancelled_count: number | null;
  register_serial: string | null;
  aade_transmitted: boolean | null;
  vat_lines: VatLine[];
  departments: DepartmentLine[];
  confidence: Record<string, "high" | "low">;
  warnings: string[];
}

// ---------- Phase 2: inventory + POS ----------

export interface ProductVariant {
  id: number;
  product_id: number;
  woo_variation_id: number | null;
  ean: string | null;
  size: string | null;
  color: string | null;
  price: number;
  stock: number;
}

export interface Product {
  id: number;
  woo_id: number | null;
  mpn: string | null;
  name: string;
  category: string | null;
  manufacturer: string | null;
  color: string | null;
  image_url: string | null;
  vat_rate: number;
  total_stock: number;
  variant_count: number;
  min_price: number | null;
  max_price: number | null;
}

export interface ProductDetail extends Omit<Product, "total_stock" | "variant_count" | "min_price" | "max_price"> {
  link: string | null;
  description: string | null;
  variants: ProductVariant[];
}

/** POS barcode lookup result: the matched variant with its product context. */
export interface LookupResult {
  variant: ProductVariant;
  product: { id: number; name: string; mpn: string | null; manufacturer: string | null; image_url: string | null; vat_rate: number };
}

export type SaleType = "sale" | "return";
export type PaymentMethod = "cash" | "card";

export interface SaleLine {
  id: number;
  variant_id: number | null;
  product_name: string;
  variant_label: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface Sale {
  id: number;
  type: SaleType;
  business_date: string;
  channel: "local" | "eshop";
  payment_method: PaymentMethod;
  total: number;
  notes: string | null;
  fiscal_status: "none" | "pending" | "issued" | "failed";
  voided_at: string | null;
  created_at: string;
  lines: SaleLine[];
}

export interface SalesDay {
  date: string;
  sales: Sale[];
  totals: { count: number; total: number; cash: number; card: number; returns_total: number };
}

/** One product parsed from the e-shop XML feed (client-side) for bulk import. */
export interface ImportProduct {
  woo_id: number;
  mpn: string | null;
  name: string;
  category: string | null;
  manufacturer: string | null;
  color: string | null;
  image_url: string | null;
  link: string | null;
  description: string | null;
  vat_rate: number;
  variants: {
    woo_variation_id: number | null;
    ean: string | null;
    size: string | null;
    color: string | null;
    price: number;
    stock: number;
  }[];
}

export interface DashboardData {
  today: { total: number; count: number };
  week: { total: number; count: number };
  month: { total: number; count: number };
  prev_month: { total: number; count: number };
  month_over_month_pct: number | null;
  daily: { date: string; total: number }[]; // last 90 days
  cash_card: { cash: number; card: number }; // current month
  departments: { name: string; amount: number; items: number }[]; // current month
  missing_days: string[]; // last 14 days with no confirmed Z, excluding closed days
  vat_table: { vat_rate: number; gross: number; net: number; vat: number }[]; // current month
  vat_month: string; // YYYY-MM the vat table refers to
}

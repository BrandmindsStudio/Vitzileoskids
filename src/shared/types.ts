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

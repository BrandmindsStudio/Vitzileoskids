# CLAUDE.md — Vitzileos Kids Z-Report Dashboard

Architecture decisions and conventions for future sessions. Read README.md for
setup commands and the user-facing feature list.

## What this is

Phase 1 of digitizing the shop's daily Z-reports (3i fiscal register, serial
`DSN 23004085`). Photo upload → Claude vision extraction → human review/confirm →
sales dashboard. The register keeps printing paper and transmitting to AADE; this
app is a mirror, never the fiscal source of truth.

## Project layout

```
migrations/            D1 SQL migrations (apply with wrangler d1 execute --file)
scripts/seed-users.mjs Creates/updates the 2 users (owner + assistant). No signup page.
src/worker/            Hono API (runs in the Worker)
  index.ts             Route mounting; auth + origin middleware order matters
  auth.ts              PBKDF2 hashing, sessions, rate limiting, middlewares
  dates.ts             Europe/Athens business-date helpers (never use raw Date here)
  routes/              auth, reports, dashboard, photos, export (CSV), settings
src/extraction/        prompt.ts (verbatim, verified against a real report),
                       schema.ts (Zod + cross-checks), extract.ts (Anthropic call)
src/shared/types.ts    Types shared by worker and SPA
src/web/               React SPA (Vite + Tailwind v4), Greek UI, mobile-first
test/                  Vitest; fixtures/z-report-908.json is ground truth from a real Z
```

## Locked decisions — do not change without asking the owner

- **Stack**: one Worker (Hono + assets binding), D1, R2, Anthropic API. No frameworks
  swapped in, no separate backend.
- **Extraction model**: `claude-sonnet-4-6` (explicitly chosen in the spec).
- **Extraction prompt** (`src/extraction/prompt.ts`): the Greek labels are verified
  against real register output. Never "translate" or reword them. The lifetime
  fiscal-memory totals (`ΤΕΛΕΥΤΑΙΑ ΣΥΝΟΛΑ ΜΝΗΜΗΣ ΕΦΟΡΙΑΣ`) must stay excluded —
  they look like huge daily figures and are the main extraction trap.
- **VAT letters are NOT fixed to rates** — always use the printed percentage
  (this register: Α=6, Β=13, Γ=24, Δ=36, Ε=0, but other registers differ).
- Exactly **2 users**, seeded from CLI. No signup, no roles.
- `source` supports `'mydata'` because a future importer will pull the same data
  from the AADE myDATA API into the same tables. **Do not build that importer** —
  out of scope for phase 1, along with inventory/POS/WooCommerce/invoices/expenses.

## Key design choices (and why)

- **Draft-first upload**: `POST /api/reports/photos` writes R2 objects and the
  z_reports row *before* extraction runs, so a failed/timeouted Claude call can
  never lose photos. `z_number` is therefore nullable — SQLite treats NULLs as
  distinct in the `UNIQUE(business_date, z_number)` partial index, so drafts never
  collide. The API requires `z_number` before `status='confirmed'`.
- **Soft delete** via `deleted_at`; the unique index is partial
  (`WHERE deleted_at IS NULL`) so a deleted report can be re-entered.
- **Only `confirmed` reports** count for the dashboard, missing-days, and CSV.
- **Validations**: future date and missing z_number *block*; the three sum
  cross-checks (cash+card ≈ gross, ΣVAT gross ≈ gross, Σdepartments ≈ gross,
  tolerance ±0.05 €) *warn only* — implemented once in
  `src/extraction/schema.ts#crossChecks` and reused by tests and the SPA form.
- **Sessions**: random 32-byte token in an HttpOnly/Secure/Lax cookie; D1 stores
  only the SHA-256 of the token. PBKDF2 iterations are 100k because Workers'
  WebCrypto caps PBKDF2 there — the seed script must always match
  `src/worker/auth.ts` (same format string `pbkdf2:iters:salt_b64:hash_b64`).
- **CSRF**: SameSite=Lax + an Origin check on mutating methods (no token dance).
- **Timezone**: every "today"/week/month computation goes through
  `src/worker/dates.ts` (Intl with Europe/Athens). Never `new Date().toISOString()`
  for business dates.
- **Missing days**: last 14 days minus configurable closed weekdays
  (`settings.closed_weekdays`, JSON array of JS day numbers, default `[0]` =
  Sunday). Today itself is excluded (its Z appears only after closing).
- **Charts**: hand-rolled SVG (no chart library). Palette and mark rules follow the
  validated dataviz reference palette: series-1 `#2a78d6`, series-2 `#1baf7a`;
  the aqua slot is < 3:1 contrast on the light surface, so anywhere it appears the
  values must also be printed as text (relief rule).
- **CSV**: dynamic columns per VAT rate + per department found in range; UTF-8 BOM,
  comma delimiter, dot decimals, CRLF (Excel-friendly).
- **wrangler**: v4 required (`assets.run_worker_first` as a route array). The SPA
  is served by the assets binding with SPA fallback; only `/api/*` hits the Worker
  first.

## Conventions

- Zod-validate every request body/query in the route file that uses it.
- Parameterized D1 statements only; use `db.batch()` for multi-row child writes.
- Don't log photo bytes or monetary amounts at info level (`console.error` for
  failures carries error messages only).
- Greek UI copy lives inline in components (small app, no i18n layer). EUR and
  dates format via `src/web/format.ts` (`el-GR`).
- Amount inputs accept both Greek ("1.234,56") and plain ("1234.56") formats via
  `parseAmount`.

## Testing / verification

- `npm test` — extraction fixture (real report Z 908, 2026-07-03) must always pass
  end-to-end through `ExtractionSchema` + `crossChecks`.
- `npm run check` — both tsconfig projects (worker + web).
- Manual smoke test flow: migrate + seed local D1 → `npm run local` → login →
  POST fixture via `/api/reports/manual` → check dashboard/CSV.

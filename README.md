# Vitzileos Kids — Z-Report Dashboard

Mobile-first web app for a children's clothing & footwear shop in Karystos, Greece.
Whoever closes the shop photographs the daily Z-report strip from the (3i) fiscal
cash register → uploads the photos → Claude extracts the numbers → the user reviews
and confirms → the dashboard shows daily/weekly/monthly sales, cash vs card, and the
department split (ΕΝΔΥΣΗ / ΥΠΟΔΗΣΗ / E-SHOP). Original photos are archived
permanently in R2 for the accountant. The fiscal machine is **not** replaced.

## Stack

- **One Cloudflare Worker**: [Hono](https://hono.dev) (TypeScript) API under `/api/*` + static-assets binding serving a Vite + React + Tailwind SPA
- **Cloudflare D1** (SQLite) — migrations in `/migrations`
- **Cloudflare R2** — original Z-report photos (served only via the authenticated Worker route)
- **Anthropic API** (`claude-sonnet-4-6`, vision) for extraction

## Setup & deploy (exact commands)

Prerequisites: Node 20+, a Cloudflare account, `npx wrangler login`.

```bash
# 1. Install dependencies
npm install

# 2. Create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create vitzileos-zreport
#    → edit wrangler.jsonc: replace REPLACE_WITH_D1_DATABASE_ID

# 3. Apply the schema
npx wrangler d1 execute vitzileos-zreport --remote --file migrations/0001_init.sql

# 4. Create the R2 bucket for the photo archive
npx wrangler r2 bucket create vitzileos-zreport-photos

# 5. Set the Anthropic API key as a Worker secret
npx wrangler secret put ANTHROPIC_API_KEY

# 6. Build and deploy
npm run deploy

# 7. Seed the two users (owner + shop assistant) — there is no signup page
node scripts/seed-users.mjs --remote owner@example.com 'OwnerPassword' 'Όνομα' \
                            assistant@example.com 'AssistantPassword' 'Όνομα Βοηθού'
```

The seed script can also read `OWNER_EMAIL` / `OWNER_PASSWORD` / `ASSISTANT_EMAIL` /
`ASSISTANT_PASSWORD` (+ optional `OWNER_NAME` / `ASSISTANT_NAME`) env vars instead of
arguments. Re-running it updates the passwords (upsert by email).

## Local development

```bash
# one-time local setup
npx wrangler d1 execute vitzileos-zreport --local --file migrations/0001_init.sql
node scripts/seed-users.mjs --local you@example.com pass1234 'You' other@example.com pass1234 'Other'
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars

# full stack (Worker + built SPA) on http://127.0.0.1:8787
npm run local

# OR: hot-reloading frontend on :5173 proxying /api to wrangler dev on :8787
npx wrangler dev          # terminal 1
npm run dev               # terminal 2
```

## Tests & checks

```bash
npm test        # vitest — extraction schema validated against a real Z-report fixture
npm run check   # TypeScript, worker + web
```

## Pages

| Route | Purpose |
|---|---|
| `/login` | Email + password (session cookie; rate-limited) |
| `/` | Dashboard: today/week/month cards, % vs previous month, 30/90-day bar chart, cash vs card, department split, missing-days banner, monthly VAT table |
| `/upload` | Camera capture, 1–8 overlapping photos of the strip (top→bottom), client-side compression to ≤1600px JPEG, AI extraction |
| `/manual` | Manual entry with the same form |
| `/reports` | Month filter, status badges, CSV export per month |
| `/reports/:id` | Photos (zoomable) + data, edit, confirm, soft delete |

## How the upload flow protects data

1. `POST /api/reports/photos` stores the originals in R2 **and creates the draft
   report row first** — from this point the photos can never be lost.
2. `POST /api/reports/:id/extract` sends all photos to Claude in one call. On any
   failure the client opens the same review form empty, with the photos beside it.
3. The review screen warns (never blocks) when cash+card, the VAT sum, or the
   department sum differ from the gross total by more than ±0.05 €, flags duplicate
   `(business_date, z_number)` with a link to the existing record, and rejects
   future dates. Confirming sets `status = 'confirmed'`; only confirmed reports
   feed the dashboard, the missing-days check, and the CSV export.

## CSV export

`GET /api/export?month=YYYY-MM` (or `?from=&to=`) → UTF-8 (BOM) CSV with columns:
`date, z_number, gross_total, cash_total, card_total, receipt_count`, one `net`/`vat`
column pair per VAT rate found in the range, and one column per department.

## Security notes

- All routes and API endpoints require the session cookie (HttpOnly, Secure,
  SameSite=Lax); sessions are stored hashed in D1.
- Passwords: PBKDF2-SHA256, 100k iterations (WebCrypto).
- Login attempts are rate-limited per email and per IP (10 / 15 min).
- Mutations enforce an Origin check; every input is validated with Zod; all D1
  queries are parameterized.
- R2 photos are served only through `GET /api/photos/:id` behind auth — the bucket
  is never public.
- Configurable closed days (default: Sundays) via `GET/PUT /api/settings`.

# NewMux Laundry — Laundry Management System V1

Multi-tenant SaaS for laundries in Bahrain: picture-grid POS, receipts and garment tags, order tracking with barcode scanning, prepaid balances and packages, credit accounts, finance and VAT reports, staff and payroll, and an owner dashboard. One codebase serves many laundries, each fully isolated.

Built from *Laundry Management System — PRD (V1)*. [docs/PRD-COVERAGE.md](docs/PRD-COVERAGE.md) maps every requirement and acceptance criterion to the code and the tests that cover it.

| | |
|---|---|
| **Stack** | TypeScript everywhere · Fastify 5 API · PostgreSQL 16 + Prisma · React 19 + Vite + Tailwind 4 · Chromium for server-side PDFs |
| **Money** | BHD, 3 decimals, stored as `Decimal(12,3)`, calculated in integer fils |
| **Time** | Asia/Bahrain for every business date, report and the daily cash closing |
| **Language** | English UI; every string in [`packages/shared/locales/en.json`](packages/shared/locales/en.json) (shared by web, PDFs and receipts) so Arabic is a translation, not a refactor |
| **Hosting** | One Docker image + Postgres + a backup container (Coolify on Hetzner), nightly encrypted backups to a Hetzner Storage Box. Or Vercel (web + API services) with Supabase Postgres and Storage. |

## Quick start (development)

Requirements: Node 22+, PostgreSQL 16.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL, APP_SECRET; CHROMIUM_PATH optional
npm run db:migrate                          # prisma migrate deploy
npm run db:seed:demo -w @laundry/api        # plans, super admin, and the demo laundry
npm run dev                                 # API on :3000, web on :5173 (proxies /api)
```

Open http://localhost:5173 and sign in to the demo laundry:

| Shop code | User | Password | PIN | Lands on |
|---|---|---|---|---|
| `demo` | `owner` | `demo1234` | 1111 | Dashboard |
| `demo` | `manager` | `demo1234` | 2222 | Dashboard |
| `demo` | `cashier` | `demo1234` | 3333 | POS |
| `demo` | `worker` | `demo1234` | 4444 | Scan |

The NewMux super admin signs in with no shop code, using `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` from `.env` (default `admin@newmux.com` / `ChangeMe123!`). New laundries can sign themselves up at `/signup` and get a 14-day trial.

PDFs (A4 invoice, statements, payslips, report PDFs) need Chromium. Set `CHROMIUM_PATH`, or run `npx playwright install chromium` once.

## Tests

```bash
npm run typecheck      # shared + api + web
npm test               # shared unit tests + API integration tests (real Postgres: laundry_test)
npm run test:e2e       # Playwright: the acceptance criteria through the real UI (laundry_e2e)
npm run check:i18n     # every t('key') used in code exists in en.json
```

The API tests run against a real database: `TEST_DATABASE_URL`, default `postgresql://laundry:laundry@localhost:5432/laundry_test`. Each test creates its own laundry, so the database never needs resetting. Every acceptance criterion from PRD §6 has an automated test: AC1–AC10 at the API level, plus AC1, AC2, AC3, AC8 and AC9 in a real browser, with AC2 and AC9 running in phone viewports. [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs everything on each push, and also builds both Docker images.

## Repository layout

```
packages/shared   Money/VAT maths, permissions matrix, status flow, phone/time helpers,
                  settings schema, receipt + tag HTML renderers, barcodes, en.json
apps/api          Fastify API, Prisma schema + migrations, PDF rendering, jobs, seeds,
                  Vercel entrypoint (src/vercel.ts) and build step (scripts/vercel-build.ts)
apps/web          React PWA (POS, tracking, customers, finance, staff, settings, admin)
e2e               Playwright acceptance tests
deploy            Container entrypoint, backup container (restic → Storage Box)
docs              PRD coverage, architecture & accounting rules, deployment guide
```

## Deploying

**Docker / Coolify.** In Coolify, create a **Docker Compose** resource from this repo and set the variables from [`deploy/.env.example`](deploy/.env.example). Then attach your domain to the `app` service on port 3000. The app migrates the database itself on every start.

**Vercel + Supabase.** Import the repo into Vercel (the framework preset becomes *Services* from [`vercel.json`](vercel.json)) and set the variables from [`.env.example`](.env.example). The API build migrates the Supabase database once per production deployment; jobs run as Vercel Cron. Read the plan limits first: Hobby allows only daily cron and is non-commercial.

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers the full steps for both: Coolify, plain Docker, Vercel + Supabase, backups and restore, counter printer setup, and upgrades.

## Documentation

- [docs/PRD-COVERAGE.md](docs/PRD-COVERAGE.md): requirement-by-requirement status, acceptance criteria → tests, and answers to the PRD's open questions.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): tenancy, security, data model, and accounting rules (revenue recognition, VAT, wallet, packages, payroll, cash closing).
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): hosting, backups, printing, operations.

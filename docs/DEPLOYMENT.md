# Deployment and operations

There are two supported ways to run the app. Both use the same code and the same database migrations.

- **Docker / Coolify** (below): one container with the API, the web app and Chromium, plus Postgres and a backup container on your own server.
- **Vercel + Supabase** ([jump](#vercel--supabase)): the web app and the API as two Vercel services, Postgres and uploaded files on Supabase.

## What runs (Docker / Coolify)

| Service | Image | Purpose |
|---|---|---|
| `app` | built from [`Dockerfile`](../Dockerfile) | API + web app on port 3000, headless Chromium for PDFs, Noto fonts for Arabic and South-Asian names. Runs `prisma migrate deploy` on start. |
| `db` | `postgres:16-alpine` | All tenant data (volume `pgdata`) |
| `backup` | built from [`deploy/backup`](../deploy/backup) | Nightly `pg_dump` + uploaded files → encrypted [restic](https://restic.net) repository on a Hetzner Storage Box |

Uploaded files (logos, item photos, damage photos, staff documents) live in the `uploads` volume. The app also runs two background jobs every hour: recurring expenses and package expiry.

## Coolify on Hetzner

1. **Storage Box.** In the Hetzner console, open the Storage Box, go to *Settings*, and enable **SSH support**. Then create a key pair just for backups:
   ```bash
   ssh-keygen -t ed25519 -N '' -f laundry_backup
   cat laundry_backup.pub | ssh -p23 u123456@u123456.your-storagebox.de install-ssh-key
   base64 -w0 < laundry_backup        # → STORAGEBOX_SSH_KEY_B64
   ```
2. **Coolify.** Go to *New Resource → Public/Private Repository*, pick this repo, choose the **Docker Compose** build pack, and keep the compose file as `/docker-compose.yml`.
3. **Environment variables.** Fill these in from [`deploy/.env.example`](../deploy/.env.example):

   | Variable | Value |
   |---|---|
   | `PUBLIC_URL` | `https://app.yourdomain.com` (used in receipt QR codes, WhatsApp and statement links) |
   | `APP_SECRET` | `openssl rand -hex 32` |
   | `POSTGRES_PASSWORD` | letters and digits only (it goes inside a URL) |
   | `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | NewMux platform admin, created on first start |
   | `STORAGEBOX_HOST` / `STORAGEBOX_USER` / `STORAGEBOX_SSH_KEY_B64` | from step 1 |
   | `RESTIC_PASSWORD` | encrypts the backups. **Store it in a password manager: without it the backups cannot be restored.** |
   | `BACKUP_HEALTHCHECK_URL` | optional, e.g. a healthchecks.io ping URL so a missed backup alerts you |

4. **Domain.** On the `app` service set the domain, e.g. `https://app.yourdomain.com:3000`. The `:3000` tells Coolify which container port to route to. Coolify issues the TLS certificate.
5. **Deploy.** The first start applies all migrations and creates the super admin. Sign in at `/login` with the super admin email and no shop code.
6. **Test the backup once.** Run `docker compose exec backup backup.sh` from Coolify's terminal on the `backup` container, and check that the log ends with `Done`.

Leave `SEED_DEMO=false` in production. On a staging server, `SEED_DEMO=true` creates the `demo` laundry.

## Without Coolify

```bash
cp deploy/.env.example .env   # fill it in
docker compose -f docker-compose.yml -f deploy/compose.ports.yml up -d --build
```

This publishes port 3000 on the host. Put Caddy or nginx with HTTPS in front of it. Keep `COOKIE_SECURE=true`, the default, whenever the site is served over HTTPS.

## Backups

- **When.** Every night at 03:00 Bahrain time (`BACKUP_SCHEDULE` is a cron expression in Asia/Bahrain).
- **What.** A `pg_dump --format=custom` of the whole database, checked with `pg_restore --list` before upload, plus the full `uploads` volume.
- **Where.** `sftp:storagebox:laundry-backups` (port 23), encrypted and deduplicated by restic.
- **Retention.** 14 daily, 8 weekly and 12 monthly snapshots (`BACKUP_KEEP_*`). Each run also reads back 2% of the stored data to catch a damaged repository early.

Useful commands, run on the `backup` container:

```bash
backup.sh                        # take a backup now
restic snapshots                 # list snapshots (after: . /etc/backup.env)
restore.sh                       # restore the latest snapshot's files into /restore
restore.sh <snapshot-id> db      # …and load the dump into the database (overwrites it!)
```

Restoring the database: stop the `app` service first, run `restore.sh latest db`, copy `/restore/data/uploads` back into the uploads volume if needed, then start `app` again.

This flow (backup, restic repository, restore into an empty database) was tested end to end. The restored database matched the original row for row.

## Vercel + Supabase

### What runs

| Piece | Where | Notes |
|---|---|---|
| `web` service | Vercel, static (`apps/web`, Vite) | Everything except `/api/*`. SPA fallback to `index.html`. |
| `api` service | Vercel Function (`apps/api/src/vercel.ts`, Fastify) | `/api/*`. One Fastify app per function instance, reused across requests. Region `syd1`, `maxDuration` 60 s. |
| Database | Supabase Postgres | Runtime through the transaction pooler (6543); migrations through `DIRECT_URL` (5432). |
| Uploaded files | Supabase Storage, private bucket `uploads` | Served only through `/api/files/:id` after the tenant check. |
| PDFs | Inside the `api` function | [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) with `playwright-core`, Noto fonts embedded from `@fontsource`. |
| Jobs | Vercel Cron → `/api/cron/*` | Protected by `CRON_SECRET`. |
| Backups | Supabase (paid plans), plus the optional [backup workflow](../.github/workflows/backup-supabase.yml) | See [Backups on Supabase](#backups-on-supabase). |

All of this is configured in [`vercel.json`](../vercel.json) using Vercel **services**. There is no root container service.

### What changed compared with Docker, and why

| Docker does | Not possible on Vercel because | On Vercel instead |
|---|---|---|
| Chromium from Playwright + `fonts-noto-core` from apt | No system packages in a function | `@sparticuz/chromium` (unpacked to `/tmp` on the first PDF of an instance, ~2–3 s); Noto Sans / Arabic / Devanagari embedded as web fonts. Docker still uses `CHROMIUM_PATH` / its bundled Chromium. |
| `setInterval` runs the jobs hourly | No long-running process | Three cron endpoints: `/api/cron/recurring-expenses`, `/api/cron/package-expiry`, `/api/cron/session-cleanup` |
| `prisma migrate deploy` on every container start | Would run on every cold start, over the pooler | `apps/api/scripts/vercel-build.ts` in the `api` build, over `DIRECT_URL`, once per deployment |
| Plans + super admin created on start; `SEED_DEMO` on start | Same | Same build script |
| Uploads in the `uploads` volume | Function disk is per instance and wiped | Supabase Storage (`STORAGE_DRIVER=supabase`, the default when `SUPABASE_URL` is set). Without it, uploads answer `503 STORAGE_NOT_CONFIGURED` instead of being silently lost. |
| Fastify serves the built web app | — | The `web` service |
| Backup container (restic, cron) | No containers or volumes | Supabase backups and/or the GitHub Actions workflow |
| In-memory login rate limit | Each function instance has its own memory | Unchanged, so limits apply per instance. The 5-failure account lock is in the database and still applies everywhere. Add a Vercel WAF rate-limit rule on `/api/auth/*` if you need a global limit. |

### Limits to know (read before going live)

- **Hobby plan is for non-commercial use.** A paid SaaS for laundries needs Vercel **Pro**.
- **Cron on Hobby runs at most once a day** (and only within the scheduled hour). `vercel.json` schedules the three jobs daily around 00:05–00:25 Bahrain time (21:05–21:25 UTC). Effect: a recurring expense or a package expiry can show up to a day late, instead of up to an hour late in Docker. On Pro, change the schedules to hourly (e.g. `5 * * * *`).
- **Request and response bodies are capped at 4.5 MB** on Vercel Functions. The web app scales photos above 3.5 MB down in the browser before uploading, so camera photos fit. PDFs over 4.5 MB (staff documents, expense receipts) cannot be uploaded, and a single report/export/PDF response over 4.5 MB fails. A large shop's *Export all data* workbook is the most likely to hit this.
- **Function duration**: set to 60 s. A PDF takes about 2–3 s on a cold instance (Chromium unpacking) and well under 1 s warm, so it fits the Hobby limit comfortably. Cron jobs loop over all tenants in one call; with many hundreds of tenants they may need splitting.
- **Bundle size**: the `api` function is ~121 MB of its 250 MB limit (Chromium ~69 MB, Prisma engines ~35 MB). CI checks this ([`scripts/check-vercel-output.mjs`](../scripts/check-vercel-output.mjs)).
- **Fonts in PDFs**: Latin, Arabic and Devanagari are embedded. Other scripts (Malayalam, Tamil, Bengali, …) fall back to the small font set that ships with the serverless Chromium and may print as boxes. Docker has the full Noto set.
- **Region**: functions run in `syd1` to sit next to the test Supabase project in Sydney. When the database moves, change `regions` (two places in `vercel.json`) to the Vercel region nearest to it, e.g. `bom1` (Mumbai) or `dxb1` (Dubai).

### Set up

1. **Supabase project.** Note the database password. From *Connect* copy the **Transaction pooler** string (port 6543) and the **Session pooler** string (port 5432). Vercel has no IPv6 and the direct host `db.<ref>.supabase.co` is IPv6-only unless you buy the IPv4 add-on, so use the session pooler as `DIRECT_URL`.
2. **Lock down the Data API.** The app does not use Supabase's REST/GraphQL Data API. Migration `20261007060000_enable_row_level_security` turns RLS on for every table with no policies, so the `anon`/`authenticated` roles can read nothing; the app connects as the table owner and is unaffected. As a second layer, in the project's Data API settings turn the Data API off, or remove `public` from the exposed schemas. New tables must enable RLS in their migration; `apps/api/test/rls.test.ts` fails otherwise.
3. **Vercel project.** *Add New → Project*, import this repository, leave the root directory as the repository root. The framework preset becomes **Services** from `vercel.json`; leave the build and install commands empty.
4. **Environment variables.** Add every variable from [`/.env.example`](../.env.example) for **Production** (and Preview, see below):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Transaction pooler, port 6543, with `?pgbouncer=true` |
   | `DIRECT_URL` | Session pooler, port 5432 (or the direct host with the IPv4 add-on) |
   | `APP_SECRET` | `openssl rand -hex 32` |
   | `PUBLIC_URL` | `https://<your domain>` (defaults to the Vercel production URL) |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Created by the first build if no super admin exists |
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | *Project Settings → API Keys*: project URL and the **secret** (or legacy `service_role`) key. Server-side only. |
   | `SUPABASE_STORAGE_BUCKET` | `uploads` (created by the build) |
   | `SEED_DEMO` | `true` only on the test project, to create the `demo` shop |
   | `MIGRATE_ON_BUILD` | See below |

5. **Deploy.** The `api` build runs `prisma generate`, `prisma migrate deploy`, creates the plans and the super admin, the demo shop if `SEED_DEMO=true`, and the storage bucket. Then sign in at `/login`: the super admin with no shop code, or the demo shop (`demo` / `owner` / `demo1234`).
6. **Check the crons** in *Project → Settings → Cron Jobs*. Use *Run* once on each and check the response is `{"ok":true,…}`. Crons only run on the production deployment.

### Migrations and environments

`vercel-build.ts` only migrates when the build owns the database:

- **Production builds**: migrate by default.
- **Preview builds**: skip by default, so a pull request with a new migration never changes a shared database before it is merged. Give Preview its own database (e.g. a second Supabase project or a Supabase branch) and set `MIGRATE_ON_BUILD=true` for the Preview environment. Otherwise previews run against the existing schema.
- `MIGRATE_ON_BUILD=false` disables it everywhere, if you prefer to run `npm run db:migrate -w @laundry/api` from CI with `DIRECT_URL` set.

A failing migration fails the build, so the new code is never promoted. The previous deployment keeps serving during the build and sees the migrated schema for a short time. As with Docker, write migrations that the previous version still works with (add columns first, drop them in a later release).

To run migrations or the demo seed by hand against Supabase (e.g. from your laptop):

```bash
DATABASE_URL='<session pooler 5432>' DIRECT_URL='<session pooler 5432>' npm run db:migrate -w @laundry/api
DATABASE_URL='<session pooler 5432>' npm run db:seed:demo -w @laundry/api   # test project only
```

### Backups on Supabase

- **Supabase**: Pro and above take daily backups (7 days on Pro) and offer point-in-time recovery as an add-on. The Free plan takes no automatic backups, so on Free the workflow below is your only backup.
- **Off-site, encrypted, same as Docker**: [`.github/workflows/backup-supabase.yml`](../.github/workflows/backup-supabase.yml) runs the [`deploy/backup`](../deploy/backup) image nightly (03:00 Bahrain) with `pg_dump` 17 against Supabase and pushes to the Storage Box with restic, under `laundry-backups-supabase`. It is off until you set the repository variable `SUPABASE_BACKUP=true` and the secrets `SUPABASE_BACKUP_DATABASE_URL` (session pooler), `STORAGEBOX_HOST`, `STORAGEBOX_USER`, `STORAGEBOX_SSH_KEY_B64`, `RESTIC_PASSWORD` and optionally `BACKUP_HEALTHCHECK_URL`. It dumps the `public` schema only (the app's tables, not Supabase's own schemas). Restore with `restore.sh` as described under [Backups](#backups), into an empty database.
- **Uploaded files in Supabase Storage are not in either backup.** Download the bucket periodically (e.g. with the Supabase CLI or an S3 client against Storage's S3 endpoint) if those files matter.

### Local check of the Vercel build

CI runs this on every push (job `vercel`). To reproduce it without a Vercel account or database:

```bash
mkdir -p .vercel && echo '{"projectId":"prj_local","orgId":"team_local","settings":{"framework":"services"}}' > .vercel/project.json
MIGRATE_ON_BUILD=false npx vercel@62.7.0 build --prod --yes
node scripts/check-vercel-output.mjs
```

## Counter printing

Receipts (80mm) and tags print through the browser, so there is nothing to install. For **silent printing**, with no dialog after each order:

1. Install the printer driver, e.g. the E-POS ECO250 Windows driver. Set the paper to 80mm roll and make it the **default printer**.
2. Start Chrome or Edge with kiosk printing. Use a desktop shortcut for the counter PC:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://app.yourdomain.com/pos
   ```
3. In *Settings → Printing*, choose the tag format:
   - **80mm paper** (default): tags print on the same thermal roll as the receipt, one tag per cut. This is fully silent, with one printer.
   - **Label printer**: set the label size, e.g. 50×30 mm. Silent printing only reaches the default printer, so a second label printer either uses the normal print dialog or is the default in a second kiosk shortcut.

Phones and tablets use the system print sheet (AirPrint / Android print service). PDFs (A4 invoice, statements, payslips, reports) are generated on the server and open in a new tab.

## Upgrades

Push to the deployed branch, then redeploy in Coolify (or enable auto-deploy). Migrations run on container start and only ever move forward. Tenant data is never deleted. When a subscription expires the tenant switches to read-only mode instead.

## Configuration reference (app, Docker)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | set by compose |
| `DIRECT_URL` | `DATABASE_URL` | migration connection; only differs on Supabase |
| `APP_SECRET` | — | signs public receipt and statement links |
| `PUBLIC_URL` | `http://localhost:3000` | external URL, no trailing slash |
| `COOKIE_SECURE` | `true` in compose | `Secure` session cookies |
| `UPLOAD_DIR` | `/data/uploads` | persistent volume |
| `CHROMIUM_PATH` | bundled headless shell | override only if you bring your own Chromium |
| `RUN_MIGRATIONS` | `true` | set `false` to manage migrations yourself |
| `SEED_DEMO` | `false` | creates the `demo` laundry on start |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | — | created only if no super admin exists |
| `CRON_SECRET` | — | enables `/api/cron/*` (not needed in Docker: jobs run in-process) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | — / — / `uploads` | store uploads in Supabase Storage instead of `UPLOAD_DIR` |

For Vercel + Supabase the full list is in [`/.env.example`](../.env.example).

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
   | `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Ghasla platform admin, created on first start |
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
| `api` service | Vercel Function (`apps/api/src/vercel.ts`, Fastify) | `/api/*`. One Fastify app per function instance, reused across requests. Region `bom1`, `maxDuration` 60 s. |
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
- **Rate limits** (staff login and PIN, public signup, shop-code lookup, order placement, sign-in codes) are counted in Postgres (table `RateLimitBucket`), not in memory, so they hold across all serverless instances. Each limited request costs one small database write; the daily `session-cleanup` job removes spent counters. If the counter store ever fails, requests are let through and the failure is logged (staff login also has its own account lockout).
- **Security headers for the staff app.** In Docker the API serves the app with helmet; on Vercel the `web` service sends the same Content-Security-Policy and `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` from `vercel.json` (the camera is allowed for the barcode scanner; microphone, location and payments are not). The policy lives in [`apps/api/src/lib/csp.ts`](../apps/api/src/lib/csp.ts); if you change it, copy it into `vercel.json` too, because `test/security-headers.test.ts` fails when they differ. Scripts, styles and images must come from the app itself: to add a third-party script or font, allow its host in the policy deliberately. HSTS is added by Vercel for HTTPS deployments.
- **Request and response bodies are capped at 4.5 MB** on Vercel Functions. The web app scales photos above 3.5 MB down in the browser before uploading, so camera photos fit. PDFs over 4.5 MB (staff documents, expense receipts) cannot be uploaded, and a single report/export/PDF response over 4.5 MB fails. A large shop's *Export all data* workbook is the most likely to hit this.
- **Function duration**: set to 60 s. A PDF takes about 2–3 s on a cold instance (Chromium unpacking) and well under 1 s warm, so it fits the Hobby limit comfortably. Cron jobs loop over all tenants in one call; with many hundreds of tenants they may need splitting.
- **Bundle size**: the `api` function is ~121 MB of its 250 MB limit (Chromium ~69 MB, Prisma engines ~35 MB). CI checks this ([`scripts/check-vercel-output.mjs`](../scripts/check-vercel-output.mjs)).
- **Fonts in PDFs**: Latin, Arabic and Devanagari are embedded. Other scripts (Malayalam, Tamil, Bengali, …) fall back to the small font set that ships with the serverless Chromium and may print as boxes. Docker has the full Noto set.
- **Region**: functions run in `bom1` (Mumbai) to sit next to the Supabase project in `ap-south-1`. When the database moves, change `regions` (two places in `vercel.json`) to the Vercel region nearest to it, e.g. `dxb1` (Dubai) or `fra1` (Frankfurt).

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
   | `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Created by the first build if no super admin exists. 12+ characters, not a common default, or the build fails |
   | `CUSTOMER_OTP_DEV_CODE` | **Leave unset in production** (the app refuses to start with it set). Preview / staging only |
   | `PUBLIC_SIGNUP` | `false` | `true` lets anyone create a laundry at `/signup` on a 14-day trial; off, Ghasla creates each account (see "Onboarding a paying laundry") |
   | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | bot check (Cloudflare Turnstile) on public signup; off unless both are set |
| `RESEND_API_KEY` / `MAIL_FROM` | — | email for password reset links (Resend); off unless both are set, see "Password reset" |
| `PUSH_NOTIFICATIONS` | on | `false` stops push notifications to the customer app (sent through Expo when staff receive, ready, send out or cancel an order) |
| `EXPO_ACCESS_TOKEN` | — | only if "Enhanced push security" is on for the app's Expo project |
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
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_OTP_TEMPLATE` / `WHATSAPP_OTP_LANGUAGE` | — / — / — / `en` | customer-app sign-in codes by WhatsApp (see below) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | — | SMS fallback for sign-in codes |
| `CUSTOMER_OTP_PILOT_NUMBERS` / `CUSTOMER_OTP_PILOT_CODE` | — | pilot sign-in for a few known numbers with a fixed 6-digit code, no SMS (see below) |
| `CUSTOMER_OTP_COUNTRIES` / `CUSTOMER_OTP_MAX_PER_PHONE_DAY` / `CUSTOMER_OTP_MAX_PER_IP_HOUR` / `CUSTOMER_OTP_MAX_PER_HOUR` / `CUSTOMER_OTP_MAX_PER_DAY` | Gulf states / 10 / 10 / 300 / 1000 | abuse limits for sign-in codes (see below) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | — / — / `uploads` | store uploads in Supabase Storage instead of `UPLOAD_DIR` |

For Vercel + Supabase the full list is in [`/.env.example`](../.env.example).

### Password reset

Anyone with an email address on their account can use "Forgot your password?" on the sign-in page. The link works once and lasts an hour; using it signs the account out everywhere and clears any lockout. This needs `RESEND_API_KEY` and `MAIL_FROM` (a sender on a domain verified in Resend). Without them nothing is sent and the form says so only in general terms, so it never reveals which accounts exist.

Without email, or for an account with no email on file:

- A shop owner resets a staff member's password in **Settings → Users**.
- For an owner, Ghasla support opens the shop in the platform admin and uses **Reset link** next to the owner. That creates a one-time link (valid 24 hours) to hand over by hand. The action is written to the shop's audit log.

### Onboarding a paying laundry

Public signup is **off** by default (`PUBLIC_SIGNUP` unset or `false`): `/signup` shows a "contact us" page, the login screen links to `info@newmux.com`, and `POST /api/onboarding/signup` answers 403 `SIGNUP_CLOSED`. A laundry gets access after it has paid:

1. Agree the plan with the laundry and receive its payment (bank transfer, BenefitPay, cash: recorded by hand).
2. Sign in as the platform super admin (no shop code) and create the shop: name, shop code, plan, and the owner's name, username and a temporary password. Give it a short trial (or 0 days) if the payment is already in.
3. Open the shop and press **Renew** for the months paid. That activates the account, marks it paid and sets the period end. When the period ends the account becomes read-only; its data is never deleted.
4. Send the owner the shop code, username and temporary password (they change it at first sign-in), or issue a **Reset link** instead.
5. If the shop will use the customer app, the owner turns on Settings → Customer app and gives customers the shop code.

To let laundries sign themselves up for a trial instead, set `PUBLIC_SIGNUP=true` (and turn on the bot check below).

### Signup bot check

Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (create a free widget in the Cloudflare dashboard under Turnstile, with your app's domain) to require the check on `/signup`. The server verifies the token before looking anything up and refuses signups if Cloudflare cannot be reached. The Content-Security-Policy allows the Turnstile script and frame, nothing else.

### Customer app sign-in codes

A customer proves their mobile number once per device (the session then lasts 90 days and renews while in use). Each channel is on only when its variables are set. With both set, the code goes by WhatsApp and falls back to SMS if WhatsApp refuses or times out. With only the `TWILIO_*` variables set (the current launch plan), it goes by SMS only. With neither set, the code is written to the server log, which is for local development only.

- **WhatsApp:** in Meta Business, create a WhatsApp Business account and a system user with a permanent token, then an **Authentication** template whose body has the code as `{{1}}` and a *copy code* button. Set `WHATSAPP_OTP_TEMPLATE` to its name and `WHATSAPP_OTP_LANGUAGE` to the language it was approved in (one language per template; add a second template later if you need Arabic and English).
- **SMS:** a Twilio number, or a messaging service with a sender ID registered for the countries you send to. Several Gulf countries require registered sender IDs, so check each country before launch. A Twilio trial account sends only to verified numbers, so upgrade it before real customers sign in. Prices differ a lot by country (Saudi Arabia costs several times Bahrain), so check Twilio's per-country pricing.
- If neither channel accepts the message, the app gets a 503 and that code is discarded.
- Messages cost money, so restrict the countries your provider may send to (Twilio *Geo permissions*) to the ones you serve.

#### Pilot without an SMS provider

While one laundry is testing and no SMS provider is paid for, set `CUSTOMER_OTP_PILOT_NUMBERS` (comma-separated phone numbers, with country code, e.g. `97333123456,97333654321`) and `CUSTOMER_OTP_PILOT_CODE` (a 6-digit code only you know). Those numbers sign in with that code and are never sent a message; every other number is unaffected and still gets a normal code. Both settings are required, and the country rules and limits still apply. A listed number always uses the pilot code, even if `CUSTOMER_OTP_DEV_CODE` is also set (every other number would then get that dev code, so leave it unset in production; the server logs a warning at start-up when it is set). The server logs a warning at start-up saying how many numbers are enabled. Treat the code as a password: anyone who knows it and a listed number can sign in as that person. Remove both settings once real SMS is connected.

#### Protection against code-farming (SMS pumping)

Every code is a paid message, so an attacker can try to make the service send thousands of them (to premium-rate numbers they profit from, or to run up your bill). The API refuses a request before anything is sent unless it passes all of these, in this order:

1. **Country allow-list** (`CUSTOMER_OTP_COUNTRIES`): the number must be a Gulf mobile number of the right length. Other countries get `unsupported_country`; nothing is stored or sent.
2. **Per phone:** 5 codes per 10 minutes and `CUSTOMER_OTP_MAX_PER_PHONE_DAY` per 24 hours.
3. **Per source IP:** `CUSTOMER_OTP_MAX_PER_IP_HOUR` per hour (the IP is stored only as a salted hash).
4. **Circuit breaker:** `CUSTOMER_OTP_MAX_PER_HOUR` / `CUSTOMER_OTP_MAX_PER_DAY` across everyone. When it trips, sign-in answers `otp_busy` until the window clears and the server logs an `error` line ("circuit breaker tripped"); set a log alert on it. Real sign-ups are blocked while it is tripped, so size it above your real peak.

The limits are counted in the database, not in memory, so they hold across Vercel instances, and a burst of simultaneous requests still sends at most the limit. Refused requests leave nothing behind, so they cannot keep a number or the service locked out.

These caps limit how much one attacker can spend, but they cannot stop a patient one who stays under them, so also set these at the provider, where they are enforced for you:

- **Twilio Geo permissions:** enable SMS only for the countries you serve.
- **Twilio balance:** keep auto-recharge off and top up manually (or set a low recharge amount). The balance is then a hard ceiling on any loss.
- **Twilio usage alerts / triggers:** alert on daily spend well above your normal.

## Production safety checks

When `NODE_ENV=production` (the Docker image) or `VERCEL_ENV=production`, the app refuses to start if any of these hold, and lists every problem at once:

- `APP_SECRET` is shorter than 32 characters or looks like a placeholder
- `SUPERADMIN_PASSWORD` is shorter than 12 characters or a well-known default (the same rule stops the build from creating a weak super admin)
- `CUSTOMER_OTP_DEV_CODE` is set
- `CRON_SECRET` is set but shorter than 16 characters
- cookies are not `Secure`, or `PUBLIC_URL` is not `https://`

Preview deployments are not production, so they are not checked.

In production, customer sign-in codes are never written to the logs. With no WhatsApp or SMS channel configured, a number that is not a listed pilot number gets a 503 (`otp_unavailable`) and no code is created; pilot numbers still sign in with the pilot code.

Wrong sign-in codes are counted per phone number across every code issued in 15 minutes: after 10, the number is refused with `rate_limited` until the window passes, however many new codes are requested. Codes are stored as a keyed hash (HMAC with `APP_SECRET`), so a leaked database does not reveal which 6-digit codes are live. Codes already issued when this is deployed stop working (they last 5 minutes), so a customer mid sign-in just requests a new one.

## Public legal pages

`/privacy`, `/terms` and `/support` are static pages (English and Arabic on one page, no scripts) in `apps/web/public/`: `privacy.html`, `terms.html`, `support.html` and the shared `legal.css`. The customer app and the App Store listing link to them (`app.json → expo.extra` in the customer app). On Vercel they are served by the `rewrites` in `vercel.json`; in Docker the API serves them at the same clean URLs.

When the operator, the contact address, the providers (hosting, message delivery) or what the app collects change, update the pages and their "Last updated" date. Have a lawyer review the wording before relying on it.

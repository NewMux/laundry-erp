# Deployment and operations

## What runs

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

## Configuration reference (app)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | set by compose |
| `APP_SECRET` | — | signs public receipt and statement links |
| `PUBLIC_URL` | `http://localhost:3000` | external URL, no trailing slash |
| `COOKIE_SECURE` | `true` in compose | `Secure` session cookies |
| `UPLOAD_DIR` | `/data/uploads` | persistent volume |
| `CHROMIUM_PATH` | bundled headless shell | override only if you bring your own Chromium |
| `RUN_MIGRATIONS` | `true` | set `false` to manage migrations yourself |
| `SEED_DEMO` | `false` | creates the `demo` laundry on start |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | — | created only if no super admin exists |

#!/bin/sh
# One backup run: database dump + uploads → restic, then apply retention.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env

STAMP=$(date +%Y-%m-%dT%H%M)
WORK=/tmp/backup
rm -rf "$WORK" && mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

log() { echo "[backup $(date '+%F %T')] $*"; }

if ! restic cat config > /dev/null 2>&1; then
  log "Initialising restic repository $RESTIC_REPOSITORY"
  restic init
fi

# DATABASE_URL (e.g. Supabase) takes precedence over the PG* variables.
# PGDUMP_ARGS adds options, e.g. "--schema=public" to skip Supabase's own schemas.
log "Dumping database ${PGDATABASE:-laundry}"
# shellcheck disable=SC2086
pg_dump --format=custom --no-owner ${PGDUMP_ARGS:-} --file "$WORK/laundry.dump" ${DATABASE_URL:+--dbname="$DATABASE_URL"}
pg_restore --list "$WORK/laundry.dump" > /dev/null   # sanity check: the dump is readable

log "Uploading to $RESTIC_REPOSITORY"
UPLOADS="${UPLOADS_PATH:-/data/uploads}"
# On Vercel + Supabase there is no uploads volume (files live in Supabase Storage).
[ -d "$UPLOADS" ] || UPLOADS=""
restic backup --host laundry --tag nightly --tag "$STAMP" "$WORK/laundry.dump" $UPLOADS

log "Applying retention (daily ${BACKUP_KEEP_DAILY}, weekly ${BACKUP_KEEP_WEEKLY}, monthly ${BACKUP_KEEP_MONTHLY})"
restic forget --host laundry --prune \
  --keep-daily "$BACKUP_KEEP_DAILY" --keep-weekly "$BACKUP_KEEP_WEEKLY" --keep-monthly "$BACKUP_KEEP_MONTHLY"

# Read back a sample of the data so a broken repository is noticed early.
restic check --read-data-subset=2%

if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
  wget -q -O /dev/null "$BACKUP_HEALTHCHECK_URL" || true
fi
log "Done"

#!/bin/sh
# Restore a snapshot into /restore (default: latest).
#   docker compose exec backup restore.sh            → files in /restore
#   docker compose exec backup restore.sh latest db  → also pg_restore into $PGDATABASE (overwrites!)
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
SNAPSHOT="${1:-latest}"
TARGET="${RESTORE_DIR:-/restore}"
rm -rf "$TARGET" && mkdir -p "$TARGET"
restic restore "$SNAPSHOT" --target "$TARGET"
echo "Restored snapshot $SNAPSHOT into $TARGET"
find "$TARGET" -maxdepth 4 | head -20
if [ "${2:-}" = "db" ]; then
  DUMP=$(find "$TARGET" -name laundry.dump | head -1)
  echo "Restoring $DUMP into database ${PGDATABASE} (existing objects are dropped)"
  pg_restore --clean --if-exists --no-owner --dbname "$PGDATABASE" "$DUMP"
  echo "Database restored. Copy $TARGET/data/uploads back into the uploads volume if needed."
fi

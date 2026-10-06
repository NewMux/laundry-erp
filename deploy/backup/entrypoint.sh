#!/bin/sh
# Prepares SSH access to the Storage Box, then runs backup.sh on a cron schedule.
set -e

: "${STORAGEBOX_HOST:?set STORAGEBOX_HOST, e.g. u123456.your-storagebox.de}"
: "${STORAGEBOX_USER:?set STORAGEBOX_USER, e.g. u123456}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD (keep a copy outside the server — backups cannot be restored without it)}"
: "${PGPASSWORD:?set PGPASSWORD}"

mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ -n "${STORAGEBOX_SSH_KEY_B64:-}" ]; then
  echo "$STORAGEBOX_SSH_KEY_B64" | base64 -d > /root/.ssh/id_backup
elif [ -n "${STORAGEBOX_SSH_KEY:-}" ]; then
  printf '%s\n' "$STORAGEBOX_SSH_KEY" > /root/.ssh/id_backup
else
  echo "Set STORAGEBOX_SSH_KEY_B64 (base64 of the private key) or STORAGEBOX_SSH_KEY" >&2
  exit 1
fi
chmod 600 /root/.ssh/id_backup
cat > /root/.ssh/config <<CFG
Host storagebox
  HostName ${STORAGEBOX_HOST}
  User ${STORAGEBOX_USER}
  Port ${STORAGEBOX_PORT:-23}
  IdentityFile /root/.ssh/id_backup
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
  ServerAliveInterval 60
CFG

export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-sftp:storagebox:${STORAGEBOX_PATH:-laundry-backups}}"

# Cron jobs don't inherit the environment: save it for backup.sh.
export -p > /etc/backup.env
chmod 600 /etc/backup.env

if [ "${1:-}" = "now" ]; then
  exec /usr/local/bin/backup.sh
fi

echo "${BACKUP_SCHEDULE} . /etc/backup.env; /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "Backups scheduled: '${BACKUP_SCHEDULE}' (${TZ}) → ${RESTIC_REPOSITORY}"
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  /usr/local/bin/backup.sh || echo "Initial backup failed" >&2
fi
exec crond -f -l 8

#!/bin/sh
set -e

# Apply pending database migrations before starting (safe to run on every boot).
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  /app/node_modules/.bin/prisma migrate deploy --schema /app/apps/api/prisma/schema.prisma
fi

# Optional: create the demo shop on first boot (staging only).
if [ "${SEED_DEMO:-false}" = "true" ]; then
  node /app/apps/api/dist/seed/cli.js --demo || true
fi

exec "$@"

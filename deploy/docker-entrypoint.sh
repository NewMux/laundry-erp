#!/bin/sh
set -e

# The schema declares a separate migration URL (DIRECT_URL, used on Supabase).
# With a single Postgres the two are the same.
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"

# Apply pending database migrations before starting (safe to run on every boot).
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  /app/node_modules/.bin/prisma migrate deploy --schema /app/apps/api/prisma/schema.prisma
fi

# Optional: create the demo shop on first boot (staging only).
if [ "${SEED_DEMO:-false}" = "true" ]; then
  node /app/apps/api/dist/seed/cli.js --demo || true
fi

exec "$@"

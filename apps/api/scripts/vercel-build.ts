/**
 * Build step of the "api" service on Vercel (vercel.json → services.api.buildCommand).
 *
 * Vercel bundles src/vercel.ts itself; this script does what the Docker
 * entrypoint does on every start, but once per deployment:
 *   1. prisma generate
 *   2. prisma migrate deploy, over DIRECT_URL (not the pgbouncer pool)
 *   3. plans + the super admin (idempotent), and the demo shop if SEED_DEMO=true
 *      (resumable: a run that failed half way is completed by the next build)
 *   4. the private Supabase Storage bucket for uploads, if it is missing
 *
 * Steps 2–4 write to the database, so they only run when this build owns it:
 * by default on Production deployments only. Set MIGRATE_ON_BUILD=true on a
 * Preview environment that has its own database, or false to manage
 * migrations yourself (e.g. from CI). A failed migration fails the build, so
 * the new code is never promoted against an old schema.
 *
 * Writes nothing to dist/: with a dist/ server file present Vercel would
 * deploy that instead of src/vercel.ts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const log = (msg: string) => console.log(`[vercel-build] ${msg}`);

function prisma(...args: string[]) {
  execFileSync(process.execPath, [path.join(here, 'prisma.mjs'), ...args], { stdio: 'inherit', cwd: path.join(here, '..') });
}

async function main() {
  prisma('generate');

  const flag = env.MIGRATE_ON_BUILD?.toLowerCase();
  const migrate = flag ? flag === 'true' : env.VERCEL_ENV === 'production';
  if (!migrate) {
    log(`Skipping migrations and setup (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}, MIGRATE_ON_BUILD=${env.MIGRATE_ON_BUILD ?? 'unset'}).`);
    return;
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  if (!env.DIRECT_URL && env.VERCEL) {
    throw new Error('DIRECT_URL is not set. Use the Supabase session pooler (port 5432) or direct connection for migrations.');
  }

  if (env.DIRECT_URL && /:6543\b|pgbouncer=true/.test(env.DIRECT_URL)) {
    log('Warning: DIRECT_URL looks like the transaction pooler (port 6543). Use the session pooler (port 5432): migrations and the seed need a session connection.');
  }

  log('Applying migrations (prisma migrate deploy)…');
  prisma('migrate', 'deploy');

  // Imported only now: on a fresh checkout @prisma/client exists only after `prisma generate` above.
  const { createPrisma } = await import('../src/lib/prisma');
  const { ensurePlans, ensureSuperAdmin } = await import('../src/seed/tenant-setup');
  const { seedDemo } = await import('../src/seed/demo');
  const { ensureSupabaseBucket } = await import('../src/lib/storage');

  const db = createPrisma(env.DIRECT_URL || env.DATABASE_URL);
  try {
    await ensurePlans(db);
    const admin = await ensureSuperAdmin(db, env.SUPERADMIN_EMAIL || undefined, env.SUPERADMIN_PASSWORD || undefined);
    log(admin ? `Super admin: ${admin.email}` : 'No super admin yet: set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD.');
    if (env.SEED_DEMO === 'true') {
      log((await seedDemo(db)) ? 'Demo shop created or completed (shop code "demo").' : 'Demo shop already exists.');
    }
  } finally {
    await db.$disconnect();
  }

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const bucket = env.SUPABASE_STORAGE_BUCKET || 'uploads';
    const r = await ensureSupabaseBucket(env.SUPABASE_URL.replace(/\/$/, ''), env.SUPABASE_SERVICE_ROLE_KEY, bucket);
    log(`Storage bucket "${bucket}": ${r}.`);
  } else {
    log('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: uploads are disabled on this deployment.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

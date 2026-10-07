import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient, Tenant } from '@prisma/client';
import { DEFAULT_WORKING_HOURS, parseSettings, type WorkingHours } from '@laundry/shared';
import type { Ctx } from './lib/service-context';
import { tenantDb, type TenantDb } from './lib/tenant-db';
import { generateRecurringExpenses } from './modules/finance.service';
import { expirePackages } from './modules/wallet.service';
import { subscriptionInfo } from './lib/subscription';

/**
 * Housekeeping jobs. Docker runs all of them hourly in-process (scheduleJobs);
 * on Vercel each one is a cron endpoint (modules/cron.routes.ts). All are
 * idempotent, so running them late, twice, or from both places is harmless.
 */

function systemCtx(t: Tenant): Ctx {
  return {
    tenantId: t.id,
    userId: 'system',
    userName: 'System',
    settings: parseSettings(t.settings),
    perms: { modules: {}, caps: {}, maxDiscountPercent: 0 },
    workingHours: (t.workingHours as unknown as WorkingHours) ?? DEFAULT_WORKING_HOURS,
    roleKey: null,
  };
}

/** Run `fn` for every tenant that is not read-only; returns the total it reports. */
async function forEachActiveTenant(
  prisma: PrismaClient,
  job: string,
  fn: (db: TenantDb, ctx: Ctx) => Promise<number>,
  log?: FastifyBaseLogger,
): Promise<number> {
  const tenants = await prisma.tenant.findMany();
  let total = 0;
  for (const t of tenants) {
    if (subscriptionInfo(t).readOnly) continue;
    try {
      const n = await fn(tenantDb(prisma, t.id), systemCtx(t));
      if (n) log?.info({ tenant: t.slug, job, count: n }, 'job ran');
      total += n;
    } catch (e) {
      log?.error({ err: e, tenant: t.slug, job }, 'job failed');
    }
  }
  return total;
}

/** Recurring expenses (rent, internet…) generated up to today. */
export function runRecurringExpenses(prisma: PrismaClient, log?: FastifyBaseLogger) {
  return forEachActiveTenant(prisma, 'recurring-expenses', (db, ctx) => generateRecurringExpenses(db, ctx), log);
}

/** Unused bonus credit of expired packages is written off. */
export function runPackageExpiry(prisma: PrismaClient, log?: FastifyBaseLogger) {
  return forEachActiveTenant(prisma, 'package-expiry', (db, ctx) => db.$transaction((tx) => expirePackages(tx, ctx)), log);
}

/** Expired sign-in sessions are deleted. */
export async function runSessionCleanup(prisma: PrismaClient) {
  const r = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}

/** All housekeeping jobs, in order. */
export async function runJobs(prisma: PrismaClient, log?: FastifyBaseLogger) {
  await runRecurringExpenses(prisma, log);
  await runPackageExpiry(prisma, log);
  await runSessionCleanup(prisma);
}

export function scheduleJobs(prisma: PrismaClient, log?: FastifyBaseLogger) {
  const run = () => runJobs(prisma, log).catch((e) => log?.error(e, 'jobs failed'));
  setTimeout(run, 10_000);
  return setInterval(run, 60 * 60 * 1000);
}

import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_WORKING_HOURS, parseSettings, type WorkingHours } from '@laundry/shared';
import type { Ctx } from './lib/service-context';
import { tenantDb } from './lib/tenant-db';
import { generateRecurringExpenses } from './modules/finance.service';
import { expirePackages } from './modules/wallet.service';
import { subscriptionInfo } from './lib/subscription';

/** Hourly housekeeping for every active tenant: recurring expenses, package expiry, old sessions. */
export async function runJobs(prisma: PrismaClient, log?: FastifyBaseLogger) {
  const tenants = await prisma.tenant.findMany();
  for (const t of tenants) {
    if (subscriptionInfo(t).readOnly) continue;
    const db = tenantDb(prisma, t.id);
    const ctx: Ctx = {
      tenantId: t.id,
      userId: 'system',
      userName: 'System',
      settings: parseSettings(t.settings),
      perms: { modules: {}, caps: {}, maxDiscountPercent: 0 },
      workingHours: (t.workingHours as unknown as WorkingHours) ?? DEFAULT_WORKING_HOURS,
      roleKey: null,
    };
    try {
      const created = await generateRecurringExpenses(db, ctx);
      const expired = await db.$transaction((tx) => expirePackages(tx, ctx));
      if (created || expired) log?.info({ tenant: t.slug, created, expired }, 'jobs ran');
    } catch (e) {
      log?.error({ err: e, tenant: t.slug }, 'job failed');
    }
  }
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export function scheduleJobs(prisma: PrismaClient, log?: FastifyBaseLogger) {
  const run = () => runJobs(prisma, log).catch((e) => log?.error(e, 'jobs failed'));
  setTimeout(run, 10_000);
  return setInterval(run, 60 * 60 * 1000);
}

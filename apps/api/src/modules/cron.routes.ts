import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, notFound } from '../lib/errors';
import { runPackageExpiry, runRecurringExpenses, runSessionCleanup } from '../jobs';

/**
 * Housekeeping jobs as HTTP endpoints for Vercel Cron (see vercel.json "crons").
 * Vercel calls them with GET and `Authorization: Bearer $CRON_SECRET`.
 * Without CRON_SECRET (Docker, where jobs run in-process) they don't exist.
 */
export default async function cronRoutes(app: FastifyInstance) {
  function authorize(req: FastifyRequest) {
    const secret = app.config.cronSecret;
    if (!secret) throw notFound('Route');
    const expected = Buffer.from(`Bearer ${secret}`);
    const given = Buffer.from(String(req.headers.authorization ?? ''));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid cron secret');
    }
  }

  const jobs: Record<string, () => Promise<number>> = {
    'recurring-expenses': () => runRecurringExpenses(app.prisma, app.log),
    'package-expiry': () => runPackageExpiry(app.prisma, app.log),
    'session-cleanup': () => runSessionCleanup(app.prisma),
  };

  for (const [name, run] of Object.entries(jobs)) {
    app.get(`/${name}`, async (req, reply) => {
      authorize(req);
      reply.header('Cache-Control', 'no-store');
      const started = Date.now();
      const count = await run();
      return { ok: true, job: name, count, ms: Date.now() - started };
    });
  }
}

import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/**
 * A store for @fastify/rate-limit that keeps the counters in Postgres.
 *
 * The plugin's default store is in memory, which on Vercel means one counter
 * per serverless instance: a limit of 20 requests a minute becomes 20 per
 * instance, and a cold start resets it. This store is shared by every
 * instance. One atomic upsert counts the request, so a burst of simultaneous
 * requests is counted exactly.
 *
 * It implements the part of the store contract this app uses: `incr`, `read`
 * and `child` (one namespace per route, like the plugin's own Redis store).
 */

type Callback = (err: Error | null, result?: { current: number; ttl: number }) => void;
interface RouteParams {
  routeInfo?: { method?: string | string[]; url?: string };
}

export function pgRateLimitStore(prisma: PrismaClient, log?: Pick<FastifyBaseLogger, 'error'>) {
  return class PgRateLimitStore {
    /** The plugin builds the store with its options; only the per-route children carry a namespace. */
    constructor(_options?: object, private readonly namespace = '') {}

    incr(key: string, cb: Callback, timeWindow: number) {
      const k = this.namespace + key;
      prisma
        .$queryRaw<{ count: number; ttl: number }[]>`
          INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
          VALUES (${k}, 1, now() + (${timeWindow}::int * interval '1 millisecond'))
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
            "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= now()
              THEN now() + (${timeWindow}::int * interval '1 millisecond')
              ELSE "RateLimitBucket"."resetAt" END
          RETURNING "count", (EXTRACT(EPOCH FROM ("resetAt" - now())) * 1000)::int AS "ttl"`
        .then(
          ([row]) => cb(null, { current: row.count, ttl: Math.max(0, row.ttl) }),
          (err: Error) => {
            log?.error(err, 'Rate limit store failed');
            cb(err);
          },
        );
    }

    /** The current state without counting a request. */
    read(key: string, cb: Callback) {
      const k = this.namespace + key;
      prisma
        .$queryRaw<{ count: number; ttl: number }[]>`
          SELECT "count", (EXTRACT(EPOCH FROM ("resetAt" - now())) * 1000)::int AS "ttl"
          FROM "RateLimitBucket" WHERE "key" = ${k} AND "resetAt" > now()`
        .then(
          ([row]) => cb(null, row ? { current: row.count, ttl: Math.max(0, row.ttl) } : { current: 0, ttl: 0 }),
          (err: Error) => cb(err),
        );
    }

    /** The store for one route: its counters are kept apart from every other route's. */
    child(params: object) {
      const { method, url } = (params as RouteParams).routeInfo ?? {};
      return new PgRateLimitStore(undefined, `${[method].flat().join(',')} ${url ?? ''}|`);
    }
  };
}

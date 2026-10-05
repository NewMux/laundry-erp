import { Prisma, type PrismaClient } from '@prisma/client';

/** Models that carry a tenantId column and must always be scoped. */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

/**
 * A Prisma client that can only see and write one tenant's rows.
 * Every query on a tenant-owned model gets `tenantId` added to its filter,
 * and every create gets `tenantId` set. This is the isolation boundary
 * between laundries; route handlers never use the unscoped client for tenant data.
 */
export function tenantDb(base: PrismaClient, tenantId: string) {
  if (!tenantId) throw new Error('tenantDb requires a tenantId');
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as AnyArgs;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          } else if (operation === 'create') {
            a.data = { ...(a.data as object), tenantId };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((r) => ({ ...(r as object), tenantId }));
          } else if (operation === 'upsert') {
            a.where = { ...(a.where ?? {}), tenantId };
            a.create = { ...(a.create ?? {}), tenantId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
/** Interactive-transaction client of a TenantDb (still tenant-scoped). */
export type TenantTx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0];

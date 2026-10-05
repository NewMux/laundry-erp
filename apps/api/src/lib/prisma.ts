import { Prisma, PrismaClient } from '@prisma/client';

// Serialise Decimal values as plain numbers in JSON responses.
// Money never exceeds 3 decimals, so this is exact for display and arithmetic in fils.
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: Prisma.Decimal) {
  return this.toNumber();
};

export function createPrisma(url?: string): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export type Db = PrismaClient;

/** Decimal | number | null → number */
export function num(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

export { Prisma };

/** Every table must have row level security on (Supabase Data API exposure; see the RLS migration). */
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/lib/prisma';

const prisma = createPrisma();
afterAll(() => prisma.$disconnect());

describe('row level security', () => {
  it('is enabled on every table in the public schema', async () => {
    const off = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity ORDER BY tablename`;
    expect(off.map((t) => t.tablename)).toEqual([]);
  });
});

/** The demo seed runs on every Vercel build with SEED_DEMO=true: it must complete a run that stopped half way. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../src/lib/prisma';
import { seedDemo } from '../src/seed/demo';
import { createTenant, ensurePlans } from '../src/seed/tenant-setup';
import { uniq } from './helpers';

const prisma = createPrisma();
beforeAll(() => ensurePlans(prisma));
afterAll(() => prisma.$disconnect());

async function counts(tenantId: string) {
  const where = { where: { tenantId } };
  const [roles, users, employees, customers, services, items, prices, packages, payments, orders, expenses, recurring] = await Promise.all([
    prisma.role.count(where),
    prisma.user.count(where),
    prisma.employee.count(where),
    prisma.customer.count(where),
    prisma.serviceType.count(where),
    prisma.itemType.count(where),
    prisma.priceListEntry.count(where),
    prisma.package.count(where),
    prisma.payment.count(where),
    prisma.order.count(where),
    prisma.expense.count(where),
    prisma.recurringExpense.count(where),
  ]);
  return { roles, users, employees, customers, services, items, prices, packages, payments, orders, expenses, recurring };
}

describe('seedDemo', () => {
  it('creates the demo shop once, then does nothing', async () => {
    const slug = uniq('demo');
    const tenant = await seedDemo(prisma, slug);
    expect(tenant?.slug).toBe(slug);
    const first = await counts(tenant!.id);
    expect(first).toMatchObject({ roles: 4, users: 4, employees: 3, customers: 5, orders: 6, expenses: 3, recurring: 1 });

    expect(await seedDemo(prisma, slug)).toBeNull();
    expect(await counts(tenant!.id)).toEqual(first);
  });

  it('completes a seed that stopped half way without duplicating anything', async () => {
    const complete = await counts((await seedDemo(prisma, uniq('demo')))!.id);

    // A run that stopped after the tenant and its owner, before staff, customers and orders.
    const slug = uniq('demo');
    const { tenant } = await createTenant(prisma, {
      slug,
      name: 'Clean & Press Laundry',
      template: 'standard',
      owner: { name: 'Jassim (Owner)', username: 'owner', password: 'demo1234', pin: '1111' },
    });
    expect((await seedDemo(prisma, slug))?.id).toBe(tenant.id);
    expect(await counts(tenant.id)).toEqual(complete);

    // A run that stopped after the orders: only the expenses are missing.
    await prisma.recurringExpense.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.expense.deleteMany({ where: { tenantId: tenant.id } });
    expect((await seedDemo(prisma, slug))?.id).toBe(tenant.id);
    expect(await counts(tenant.id)).toEqual(complete);
  });
});

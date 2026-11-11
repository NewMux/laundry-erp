import type { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_WORKING_HOURS, addDays, bhDate, parseSettings, type RoleKey } from '@laundry/shared';
import { hashPassword } from '../lib/crypto';
import type { Ctx } from '../lib/service-context';
import { tenantDb } from '../lib/tenant-db';
import { advanceOrder, createOrder, deliverOrder } from '../modules/orders.service';
import { applyWalletDelta } from '../modules/wallet.service';
import { createTenant, ensureTenantSetup, type CreateTenantInput } from './tenant-setup';

export const DEMO_PASSWORD = 'demo1234';

/**
 * Interactive transactions of the seed. Prisma's defaults (maxWait 2 s,
 * timeout 5 s) are too short when the build runs far from the database
 * (e.g. Vercel → Supabase): each order is a few dozen round trips.
 */
const TX = { maxWait: 20000, timeout: 60000 };

/**
 * Create the "demo" shop with users for every role and some realistic data.
 * Safe to re-run: each step checks what already exists, so a seed that
 * failed half way is completed by the next run instead of being skipped.
 * Returns the tenant when something was created, null when it was complete.
 */
export async function seedDemo(prisma: PrismaClient, slug = 'demo') {
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  // The recurring expense is the seed's last step.
  if (existing && (await prisma.recurringExpense.count({ where: { tenantId: existing.id } })) > 0) return null;
  const tenantInput: CreateTenantInput = {
    slug,
    name: 'Clean & Press Laundry',
    crNumber: '123456-1',
    vatNumber: '220012345600002',
    address: 'Shop 12, Road 3803, Block 338\nAdliya, Manama, Bahrain',
    phone: '+973 1771 0000',
    email: 'hello@cleanpress.bh',
    template: 'standard',
    planCode: 'business',
    trialDays: 30,
    owner: { name: 'Jassim (Owner)', username: 'owner', email: `owner@${slug}.laundry.test`, password: DEMO_PASSWORD, pin: '1111' },
  };
  const { tenant, roles } = existing
    ? { tenant: existing, ...(await ensureTenantSetup(prisma, existing.id, tenantInput)) }
    : await createTenant(prisma, tenantInput);
  const db = tenantDb(prisma, tenant.id);
  const staff: { key: RoleKey; name: string; username: string; pin: string; position: string }[] = [
    { key: 'MANAGER', name: 'Fatima (Manager)', username: 'manager', pin: '2222', position: 'Shop manager' },
    { key: 'CASHIER', name: 'Ravi (Cashier)', username: 'cashier', pin: '3333', position: 'Counter cashier' },
    { key: 'WORKER', name: 'Anil (Worker)', username: 'worker', pin: '4444', position: 'Washer / presser' },
  ];
  const users: Record<string, { id: string; name: string }> = {};
  for (const s of staff) {
    const found = await db.user.findFirst({ where: { username: s.username } });
    if (found) {
      users[s.key] = { id: found.id, name: found.name };
      continue;
    }
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const pinHash = await hashPassword(s.pin);
    // Employee and user together, so a retry never finds an employee without its login.
    users[s.key] = await db.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: {
          tenantId: tenant.id,
          name: s.name.replace(/ \(.*\)/, ''),
          position: s.position,
          nationality: s.key === 'MANAGER' ? 'Bahraini' : 'Indian',
          phone: '+973 3300 00' + s.pin.slice(0, 2),
          cpr: '9' + s.pin + '12345',
          cprExpiry: addDays(bhDate(), s.key === 'WORKER' ? 5 : 400),
          passportNo: s.key === 'MANAGER' ? null : 'P' + s.pin + '7788',
          passportExpiry: s.key === 'MANAGER' ? null : addDays(bhDate(), s.key === 'CASHIER' ? 25 : 700),
          visaExpiry: s.key === 'MANAGER' ? null : addDays(bhDate(), 200),
          joinDate: '2024-03-01',
          basicSalary: s.key === 'MANAGER' ? 600 : s.key === 'CASHIER' ? 280 : 180,
          allowances: s.key === 'MANAGER' ? [{ name: 'Transport', amount: 50 }] : [{ name: 'Housing', amount: 40 }],
        },
      });
      const u = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: s.name,
          username: s.username,
          passwordHash,
          pinHash,
          roleId: roles[s.key],
          employeeId: emp.id,
        },
      });
      return { id: u.id, name: u.name };
    }, TX);
  }

  const settings = parseSettings(tenant.settings);
  const cashierCtx: Ctx = {
    tenantId: tenant.id,
    userId: users.CASHIER.id,
    userName: users.CASHIER.name,
    settings,
    perms: DEFAULT_ROLE_PERMISSIONS.CASHIER,
    workingHours: DEFAULT_WORKING_HOURS,
    roleKey: 'CASHIER',
  };
  const workerCtx: Ctx = { ...cashierCtx, userId: users.WORKER.id, userName: users.WORKER.name, perms: DEFAULT_ROLE_PERMISSIONS.WORKER, roleKey: 'WORKER' };

  const customers = await Promise.all(
    [
      { name: 'Ahmed Al-Khalifa', mobile: '97333112233', addrArea: 'Riffa' },
      { name: 'Mariam Hassan', mobile: '97336554433', addrArea: 'Saar' },
      { name: 'محمد عبدالله', mobile: '97339887766', addrArea: 'Muharraq' },
      { name: 'Gulf Pearl Hotel', mobile: '97317223344', type: 'COMPANY' as const, creditEnabled: true, creditLimit: 500, addrArea: 'Seef' },
      { name: 'John Smith', mobile: '97333998877', addrArea: 'Juffair' },
    ].map((c) =>
      prisma.customer.upsert({
        where: { tenantId_mobile: { tenantId: tenant.id, mobile: c.mobile } },
        update: {},
        create: { tenantId: tenant.id, ...c },
      }),
    ),
  );

  const items = await db.itemType.findMany();
  const services = await db.serviceType.findMany();
  const item = (key: string) => items.find((i) => i.imageKey === key)!.id;
  const svc = (name: string) => services.find((s) => s.name === name)!.id;

  // Prepaid balance for Mariam (Pay 20 get 25).
  if (!(await db.payment.findFirst({ where: { receiptNo: 'R-000001' } }))) {
    await db.$transaction(async (tx) => {
      const pkg = await tx.package.findFirst({ where: { kind: 'CREDIT', price: 20 } });
      const payment = await tx.payment.create({
        data: { tenantId: tenant.id, kind: 'PACKAGE_SALE', method: 'CASH', amount: 20, customerId: customers[1].id, businessDate: bhDate(), receiptNo: 'R-000001', note: pkg?.name, createdById: cashierCtx.userId, createdByName: cashierCtx.userName },
      });
      await tx.customerPackage.create({
        data: { tenantId: tenant.id, customerId: customers[1].id, packageId: pkg!.id, name: pkg!.name, kind: 'CREDIT', pricePaid: 20, bonusGranted: 5, bonusRemaining: 5, paymentId: payment.id },
      });
      await applyWalletDelta(tx, cashierCtx, customers[1].id, { paidDelta: 20, bonusDelta: 5, type: 'PACKAGE', paymentId: payment.id, reason: pkg!.name });
      await tx.tenant.update({ where: { id: tenant.id }, data: { receiptSeq: 1 } });
    }, TX);
  }

  const orders = [
    { c: 0, express: false, lines: [{ i: 'thobe', s: 'Wash & Iron', q: 5 }, { i: 'ghutra', s: 'Wash & Iron', q: 3 }], pay: 'CASH', steps: 0 },
    { c: 1, express: true, lines: [{ i: 'abaya', s: 'Dry Clean', q: 2 }, { i: 'sheila', s: 'Iron Only', q: 2 }], pay: 'WALLET', steps: 1 },
    { c: 2, express: false, lines: [{ i: 'suit', s: 'Dry Clean', q: 1 }, { i: 'shirt', s: 'Wash & Iron', q: 4 }], pay: 'CARD', steps: 2 },
    { c: 3, express: false, lines: [{ i: 'bedsheet', s: 'Wash & Iron', q: 20 }, { i: 'towel', s: 'Wash Only', q: 30 }], pay: 'ACCOUNT', steps: 3 },
    { c: 4, express: false, lines: [{ i: 'trousers', s: 'Iron Only', q: 3 }], pay: 'NONE', steps: 3 },
    { c: 0, express: false, lines: [{ i: 'blanket', s: 'Wash & Iron', q: 1 }], pay: 'CASH', steps: 3, deliver: true },
  ];
  // Each order is one transaction, so the number of orders is how far an earlier run got.
  const done = await db.order.count();
  for (const o of orders.slice(done)) {
    await db.$transaction(
      async (tx) => {
        const created = await createOrder(
          tx,
          cashierCtx,
          {
            customerId: customers[o.c].id,
            express: o.express,
            items: o.lines.map((l) => ({ itemTypeId: item(l.i), serviceTypeId: svc(l.s), quantity: l.q })),
          },
          { onAccount: o.pay === 'ACCOUNT', payments: [] },
        );
        const fresh = await tx.order.findFirstOrThrow({ where: { id: created.id } });
        if (o.pay === 'CASH' || o.pay === 'CARD' || o.pay === 'WALLET') {
          const { applyOrderPayments, refreshPaymentState } = await import('../modules/orders.service');
          await applyOrderPayments(tx, cashierCtx, fresh, [{ method: o.pay as 'CASH', amount: Number(fresh.total) }]);
          await refreshPaymentState(tx, fresh.id);
        }
        for (let s = 0; s < o.steps; s++) {
          try {
            await advanceOrder(tx, workerCtx, created.id);
          } catch {
            break;
          }
        }
        if (o.deliver) await deliverOrder(tx, cashierCtx, created.id, null, []);
      },
      TX,
    );
  }

  const cats = await db.expenseCategory.findMany();
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const month = bhDate().slice(0, 7);
  if ((await db.expense.count()) === 0) {
    await db.expense.createMany({
      data: [
        { tenantId: tenant.id, categoryId: cat('Rent'), amount: 450, date: `${month}-01`, method: 'BANK_TRANSFER', vendor: 'Landlord', createdByName: 'Seed' },
        { tenantId: tenant.id, categoryId: cat('Detergents & Supplies'), amount: 38.5, date: bhDate(), method: 'CASH', vendor: 'Al Jazira Supplies', createdByName: 'Seed' },
        { tenantId: tenant.id, categoryId: cat('Electricity & Water'), amount: 112.75, date: `${month}-01`, method: 'BENEFIT_PAY', vendor: 'EWA', createdByName: 'Seed' },
      ],
    });
  }
  await db.recurringExpense.create({
    data: { tenantId: tenant.id, categoryId: cat('Rent'), amount: 450, method: 'BANK_TRANSFER', vendor: 'Landlord', notes: 'Shop rent', frequency: 'MONTHLY', anchorDay: 1, nextDate: `${addMonthsStr(month, 1)}-01` },
  });
  return tenant;
}

function addMonthsStr(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

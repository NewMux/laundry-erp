/**
 * PRD section 6 — acceptance criteria, exercised through the HTTP API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bhDate, monthRange } from '@laundry/shared';
import { Client, catalog, createShop, loginAs, setupApp, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => {
  await env.app.close();
  await env.prisma.$disconnect();
});

async function newCustomer(c: Client, mobile: string, extra: Record<string, unknown> = {}) {
  const r = await c.post('/api/customers', { name: `Customer ${mobile}`, mobile, ...extra });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.customer;
}

describe('AC1 — 7-item order from the picture grid, receipt + 7 tags', () => {
  it('creates an order with 7 pieces and returns print data for receipt and 7 tags', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const cust = await newCustomer(cashier, '33000001');
    const r = await cashier.post('/api/orders', {
      customerId: cust.id,
      express: false,
      items: [
        { itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 3 },
        { itemTypeId: cat.item('ghutra'), serviceTypeId: cat.service('Wash & Iron'), quantity: 2 },
        { itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Iron Only'), quantity: 1, damage: ['STAIN'], damageNotes: 'Collar stain' },
        { itemTypeId: cat.item('trousers'), serviceTypeId: cat.service('Dry Clean'), quantity: 1 },
      ],
      payments: [{ method: 'CASH', amount: 2.585 }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const o = r.json.order;
    expect(o.orderNo).toBeGreaterThan(1000);
    expect(o.pieceCount).toBe(7);
    // 3×0.4 + 2×0.3 + 0.15 + 0.7 = 2.65 ; VAT 10% = 0.265 ; total 2.915
    expect(o.total).toBe(2.915);
    expect(o.paymentState).toBe('PARTIAL');
    expect(o.balanceDue).toBe(0.33);
    const p = await cashier.get(`/api/orders/${o.id}/print`);
    expect(p.status).toBe(200);
    expect(p.json.order.pieces).toHaveLength(7);
    expect(p.json.order.items[2].damage).toEqual(['STAIN']);
    expect(p.json.canPrintReceipt).toBe(true);
  });
});

describe('AC2 — worker scans a tag from a phone and the order moves on', () => {
  it('advances the order to the next status and hides prices / phone numbers from workers', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const cust = await newCustomer(cashier, '33000002');
    const { json } = await cashier.post('/api/orders', {
      customerId: cust.id,
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 2 }],
      payments: [{ method: 'CASH', amount: 0.88 }],
    });
    const orderNo = json.order.orderNo;

    const worker = await loginAs(env.app, shop.slug, 'worker');
    let s = await worker.post('/api/tracking/scan', { code: `${orderNo}-2`, mode: 'order' });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    expect(s.json.from).toBe('RECEIVED');
    expect(s.json.to).toBe('IN_PROCESS');
    expect(s.json.order.total).toBeUndefined();
    expect(s.json.order.customer.mobile).toBeUndefined();
    s = await worker.post('/api/tracking/scan', { code: `${orderNo}-1`, mode: 'order' });
    expect(s.json.to).toBe('IRONING');
    s = await worker.post('/api/tracking/scan', { code: `O${orderNo}`, mode: 'order' });
    expect(s.json.to).toBe('READY');
    s = await worker.post('/api/tracking/scan', { code: `${orderNo}-1`, mode: 'order' });
    expect(s.status).toBe(409);

    // No money details leak through order views or print data.
    const detail = await worker.get(`/api/orders/${json.order.id}`);
    expect(detail.json.order.total).toBeUndefined();
    expect(detail.json.order.customer.walletPaid).toBeUndefined();
    expect(detail.json.order.events.every((e: any) => e.type !== 'PAYMENT' || e.note === null)).toBe(true);
    const print = await worker.get(`/api/orders/${json.order.id}/print`);
    expect(print.json.order.total).toBe(0);
    expect(print.json.order.walletBalance).toBeNull();
    expect(print.json.order.pieces).toHaveLength(2);

    // Workers have no access to customers, reports or the POS.
    expect((await worker.get('/api/customers')).status).toBe(403);
    expect((await worker.get('/api/reports/sales-by-day')).status).toBe(403);
    expect((await worker.post('/api/orders', { items: [] })).status).toBe(403);
  });

  it('can move a single piece only', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const { json } = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Wash & Iron'), quantity: 3 }],
    });
    const worker = await loginAs(env.app, shop.slug, 'worker');
    const s = await worker.post('/api/tracking/scan', { code: `${json.order.orderNo}-2`, mode: 'piece' });
    expect(s.json.moved).toEqual([{ pieceNo: 2, from: 'RECEIVED', to: 'IN_PROCESS' }]);
    expect(s.json.order.status).toBe('RECEIVED');
  });
});

describe('AC3 — top up BHD 20 with a BHD 25 package, pay from balance', () => {
  it('adds 20 paid + 5 bonus, deducts the order and shows the remaining balance', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const pkg = cat.packages.find((p) => p.kind === 'CREDIT' && Number(p.price) === 20)!;
    const cust = await newCustomer(cashier, '33000003');
    const top = await cashier.post('/api/wallet/topup', { customerId: cust.id, packageId: pkg.id, method: 'CASH' });
    expect(top.status, JSON.stringify(top.json)).toBe(200);
    expect(top.json.receipt.amountPaid).toBe(20);
    expect(top.json.receipt.creditAdded).toBe(20);
    expect(top.json.receipt.bonusAdded).toBe(5);
    expect(top.json.receipt.balanceAfter).toBe(25);

    // 5 thobes W&I = 2.000 + VAT 0.200 = 2.200, paid from balance
    const r = await cashier.post('/api/orders', {
      customerId: cust.id,
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 5 }],
      payments: [{ method: 'WALLET', amount: 2.2 }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.order.paymentState).toBe('PAID');
    const pr = await cashier.get(`/api/orders/${r.json.order.id}/print`);
    expect(pr.json.order.walletBalance).toBe(22.8);
    const c = await cashier.get(`/api/customers/${cust.id}`);
    // Split proportionally: 2.2 × 20/25 = 1.76 paid credit, 0.44 bonus
    expect(c.json.customer.walletPaid).toBe(18.24);
    expect(c.json.customer.walletBonus).toBe(4.56);

    // Revenue recognised only for the paid part of the balance; top-up is a liability.
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const pl = await owner.get(`/api/reports/profit-loss?from=${bhDate()}&to=${bhDate()}`);
    expect(pl.json.tables[0].totals.gross).toBe(1.76);
    expect(pl.json.tables[0].totals.bonus).toBe(0.44);

    // Cannot spend more than the balance.
    const over = await cashier.post('/api/orders', {
      customerId: cust.id,
      items: [{ itemTypeId: cat.item('wedding_dress'), serviceTypeId: cat.service('Dry Clean'), quantity: 2 }],
      payments: [{ method: 'WALLET', amount: 33 }],
    });
    expect(over.status).toBe(400);
  });

  it('item-count packages deduct items, not money', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const pkg = cat.packages.find((p) => p.kind === 'ITEMS')!;
    const cust = await newCustomer(cashier, '33000004');
    await cashier.post('/api/wallet/topup', { customerId: cust.id, packageId: pkg.id, method: 'CARD' });
    const cp = (await cashier.get(`/api/customers/${cust.id}`)).json.packages[0];
    expect(cp.remainingItems).toBe(30);
    const r = await cashier.post('/api/orders', {
      customerId: cust.id,
      items: [
        { itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 4, customerPackageId: cp.id },
        { itemTypeId: cat.item('ghutra'), serviceTypeId: cat.service('Wash & Iron'), quantity: 1 },
      ],
      payments: [{ method: 'CASH', amount: 0.33 }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.order.total).toBe(0.33);
    expect(r.json.order.paymentState).toBe('PAID');
    const after = (await cashier.get(`/api/customers/${cust.id}`)).json.packages[0];
    expect(after.remainingItems).toBe(26);
  });
});

describe('AC4 — credit customer monthly statement PDF', () => {
  it('charges orders to account, records a payment against invoices and renders the statement', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cat = await catalog(owner);
    const hotel = await newCustomer(owner, '17000005', { name: 'Hotel', type: 'COMPANY', creditEnabled: true, creditLimit: 100 });
    const order = async (qty: number) =>
      owner.post('/api/orders', {
        customerId: hotel.id,
        onAccount: true,
        items: [{ itemTypeId: cat.item('bedsheet'), serviceTypeId: cat.service('Wash & Iron'), quantity: qty }],
      });
    const o1 = await order(10); // 6.000 + 0.600 = 6.600
    const o2 = await order(5); // 3.300
    expect(o1.status, JSON.stringify(o1.json)).toBe(200);
    expect(o1.json.order.onAccount).toBe(true);
    expect(o1.json.order.balanceDue).toBe(6.6);

    // Credit limit is enforced.
    const big = await owner.post('/api/orders', {
      customerId: hotel.id,
      onAccount: true,
      items: [{ itemTypeId: cat.item('bedsheet'), serviceTypeId: cat.service('Wash & Iron'), quantity: 200 }],
    });
    expect(big.status).toBe(400);
    expect(big.json.error.code).toBe('CREDIT_LIMIT');

    // On-account orders can be delivered without payment.
    const worker = await loginAs(env.app, shop.slug, 'worker');
    for (let i = 0; i < 3; i++) await worker.post(`/api/orders/${o1.json.order.id}/advance`, {});
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const del = await cashier.post(`/api/orders/${o1.json.order.id}/deliver`, {});
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    expect(del.json.order.status).toBe('DELIVERED');

    const settle = await owner.post(`/api/customers/${hotel.id}/settle`, { amount: 8, method: 'BANK_TRANSFER', reference: 'TRX-1' });
    expect(settle.status, JSON.stringify(settle.json)).toBe(200);
    expect(settle.json.allocations.map((a: any) => a.amount)).toEqual([6.6, 1.4]);
    const out = await owner.get(`/api/customers/${hotel.id}/outstanding`);
    expect(out.json.orders).toHaveLength(1);
    expect(out.json.orders[0].balanceDue).toBe(1.9);
    void o2;

    const { from, to } = monthRange(bhDate().slice(0, 7));
    const pdf = await owner.get(`/api/documents/statement/${hotel.id}?type=credit&from=${from}&to=${to}`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.headers['content-type']).toBe('application/pdf');
    expect(pdf.raw.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('AC5 — daily cash closing', () => {
  it('computes expected cash correctly and locks the day', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const cust = await newCustomer(cashier, '33000006');
    // Cash sale 2.200, card sale 1.100, cash top-up 10, cash expense 3.5, cash refund (cancel paid order) 1.100
    await cashier.post('/api/orders', {
      customerId: cust.id,
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 5 }],
      payments: [{ method: 'CASH', amount: 2.2 }],
    });
    await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Iron Only'), quantity: 5 }],
      payments: [{ method: 'CARD', amount: 1.1 }],
    });
    const toCancel = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Iron Only'), quantity: 5 }],
      payments: [{ method: 'CASH', amount: 1.1 }],
    });
    await cashier.post('/api/wallet/topup', { customerId: cust.id, amount: 10, method: 'CASH' });
    const cats = (await owner.get('/api/finance/categories')).json.categories;
    const supplies = cats.find((c: any) => c.name === 'Detergents & Supplies');
    const exp = await owner.post('/api/finance/expenses', { categoryId: supplies.id, amount: 3.5, date: bhDate(), method: 'CASH', vendor: 'Shop' });
    expect(exp.status, JSON.stringify(exp.json)).toBe(200);
    const cancel = await owner.post(`/api/orders/${toCancel.json.order.id}/cancel`, { reason: 'Customer changed mind', refundMode: 'ORIGINAL' });
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);

    const sum = await cashier.get('/api/finance/cash?openingFloat=20');
    expect(sum.status).toBe(200);
    const s = sum.json.summary;
    expect(s.cashSales).toBe(3.3);
    expect(s.cashTopups).toBe(10);
    expect(s.cashRefunds).toBe(1.1);
    expect(s.cashExpenses).toBe(3.5);
    // 20 + 3.3 + 10 − 1.1 − 3.5
    expect(s.expectedCash).toBe(28.7);

    const noReason = await cashier.post('/api/finance/cash/close', { date: s.businessDate, openingFloat: 20, countedCash: 28.5 });
    expect(noReason.status).toBe(400);
    const close = await cashier.post('/api/finance/cash/close', { date: s.businessDate, openingFloat: 20, countedCash: 28.5, reason: 'Gave wrong change' });
    expect(close.status, JSON.stringify(close.json)).toBe(200);
    expect(close.json.closing.difference).toBe(-0.2);

    // Locked: no expenses on the closed day; new payments roll to the next business day.
    const late = await owner.post('/api/finance/expenses', { categoryId: supplies.id, amount: 1, date: s.businessDate, method: 'CASH' });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe('DAY_CLOSED');
    const again = await cashier.post('/api/finance/cash/close', { date: s.businessDate, openingFloat: 20, countedCash: 28.5, reason: 'x' });
    expect(again.status).toBe(409);
    const next = await cashier.get('/api/finance/cash');
    expect(next.json.currentBusinessDate > s.businessDate).toBe(true);
    const sale = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Iron Only'), quantity: 1 }],
      payments: [{ method: 'CASH', amount: 0.22 }],
    });
    expect(sale.status).toBe(200);
    const closedDay = await cashier.get(`/api/finance/cash?date=${s.businessDate}`);
    expect(closedDay.json.summary.closed).toBe(true);
    expect(closedDay.json.summary.cashSales).toBe(3.3);
  });
});

describe('AC6 + AC7 — payroll posts as Salaries expense, P&L = revenue − expenses', () => {
  it('pays payroll, posts the expense, prints payslips and reconciles P&L', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cat = await catalog(owner);
    const today = bhDate();
    const month = today.slice(0, 7);

    await owner.post('/api/orders', {
      items: [{ itemTypeId: cat.item('suit'), serviceTypeId: cat.service('Dry Clean'), quantity: 10 }],
      payments: [{ method: 'CARD', amount: 22 }],
    }); // 20 + 2 VAT
    const cats = (await owner.get('/api/finance/categories')).json.categories;
    const rent = cats.find((c: any) => c.name === 'Rent');
    await owner.post('/api/finance/expenses', { categoryId: rent.id, amount: 100, date: today, method: 'BANK_TRANSFER' });

    // Advance of 50 to the cashier's employee profile, then payroll.
    const emps = (await owner.get('/api/staff/employees')).json.employees;
    const cashierEmp = emps.find((e: any) => e.name === 'cashier');
    const adv = await owner.post('/api/staff/adjustments', { employeeId: cashierEmp.id, type: 'ADVANCE', amount: 50, date: today, method: 'CASH' });
    expect(adv.status, JSON.stringify(adv.json)).toBe(200);
    await owner.post('/api/staff/adjustments', { employeeId: cashierEmp.id, type: 'DEDUCTION', amount: 10, date: today, note: 'Late' });

    const run = await owner.post('/api/payroll/runs', { month });
    expect(run.status, JSON.stringify(run.json)).toBe(200);
    const items = run.json.run.items;
    expect(items).toHaveLength(3);
    const ci = items.find((i: any) => i.employeeName === 'cashier');
    expect(ci.basic).toBe(300);
    expect(ci.allowances).toBe(50);
    expect(ci.deductions).toBe(10);
    expect(ci.advances).toBe(50);
    expect(ci.net).toBe(290);
    expect(run.json.run.totalNet).toBe(990); // 340 + 340 + 290

    const pay = await owner.post(`/api/payroll/runs/${run.json.run.id}/pay`, { date: today, method: 'BANK_TRANSFER' });
    expect(pay.status, JSON.stringify(pay.json)).toBe(200);
    expect(pay.json.run.status).toBe('PAID');
    const salaries = (await owner.get(`/api/finance/expenses?from=${today}&to=${today}`)).json.expenses.filter((e: any) => e.category.name === 'Salaries');
    // 3 net-pay expenses + the advance
    expect(salaries).toHaveLength(4);
    expect(salaries.reduce((s: number, e: any) => s + e.amount, 0)).toBe(1040);

    const slip = await owner.get(`/api/documents/payslip/${ci.id}`);
    expect(slip.status).toBe(200);
    expect(slip.raw.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    const pl = await owner.get(`/api/reports/profit-loss?from=${month}-01&to=${today}`);
    const tot = pl.json.tables[0].totals;
    expect(tot.gross).toBe(22);
    expect(tot.vat).toBe(2);
    expect(tot.net).toBe(20);
    expect(tot.expenses).toBe(1140);
    expect(tot.profit).toBe(-1120);

    // Paid payroll cannot be recalculated; salary expenses can't be edited from expenses.
    expect((await owner.post('/api/payroll/runs', { month })).status).toBe(409);
    expect((await owner.del(`/api/finance/expenses/${salaries[0].id}`)).status).toBe(400);
  });
});

describe('AC8 — cashier cannot see reports or delete a paid invoice', () => {
  it('blocks the attempts and writes them to the audit log', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(cashier);
    const r = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 1 }],
      payments: [{ method: 'CASH', amount: 0.44 }],
    });
    for (const key of ['profit-loss', 'sales-by-day', 'vat']) {
      expect((await cashier.get(`/api/reports/${key}`)).status).toBe(403);
    }
    expect((await cashier.get('/api/dashboard')).status).toBe(403);
    expect((await cashier.get('/api/reports')).json.reports).toEqual([]);
    const cancel = await cashier.post(`/api/orders/${r.json.order.id}/cancel`, { reason: 'test cancel' });
    expect(cancel.status).toBe(403);

    // Even with pos.delete granted, a paid invoice needs the cancelPaidOrders capability.
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const roles = (await owner.get('/api/settings/roles')).json.roles;
    const cr = roles.find((x: any) => x.key === 'CASHIER');
    const perms = { ...cr.permissions, modules: { ...cr.permissions.modules, pos: ['view', 'create', 'edit', 'delete'] } };
    expect((await owner.put(`/api/settings/roles/${cr.id}`, { permissions: perms })).status).toBe(200);
    const cancel2 = await cashier.post(`/api/orders/${r.json.order.id}/cancel`, { reason: 'test cancel' });
    expect(cancel2.status).toBe(403);
    expect(cancel2.json.error.message).toMatch(/paid invoice/);

    const logs = (await owner.get('/api/audit?action=order.cancel_blocked')).json.logs;
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const reportBlocked = (await owner.get('/api/audit?action=report.blocked')).json.logs;
    expect(reportBlocked.length).toBeGreaterThanOrEqual(3);

    // Discount above the cashier's 5% limit is refused.
    const disc = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 10 }],
      orderDiscountType: 'PERCENT',
      orderDiscountValue: 10,
    });
    expect(disc.status).toBe(403);
    expect(disc.json.error.code).toBe('DISCOUNT_LIMIT');
    const ok = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 10 }],
      orderDiscountType: 'PERCENT',
      orderDiscountValue: 5,
    });
    expect(ok.status).toBe(200);
    expect((await owner.get('/api/audit?action=order.discount')).json.logs.length).toBe(1);
    // Price override needs the capability.
    const override = await cashier.post('/api/orders', {
      items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 1, unitPrice: 0.1 }],
    });
    expect(override.status).toBe(403);
  });
});

describe('AC10 — two tenants cannot see each other’s data', () => {
  it('isolates customers, orders, scans, files and reports', async () => {
    const a = await createShop(env.prisma);
    const b = await createShop(env.prisma);
    const ownerA = await loginAs(env.app, a.slug, 'owner');
    const ownerB = await loginAs(env.app, b.slug, 'owner');
    const catA = await catalog(ownerA);
    const custA = await newCustomer(ownerA, '33000010', { name: 'Secret A customer' });
    const orderA = (
      await ownerA.post('/api/orders', {
        customerId: custA.id,
        items: [{ itemTypeId: catA.item('thobe'), serviceTypeId: catA.service('Wash & Iron'), quantity: 1 }],
        payments: [{ method: 'CASH', amount: 0.44 }],
      })
    ).json.order;

    // Same mobile can exist in both shops independently.
    await newCustomer(ownerB, '33000010', { name: 'B customer' });

    expect((await ownerB.get(`/api/customers/${custA.id}`)).status).toBe(404);
    expect((await ownerB.get(`/api/orders/${orderA.id}`)).status).toBe(404);
    expect((await ownerB.patch(`/api/customers/${custA.id}`, { name: 'hacked' })).status).toBe(404);
    expect((await ownerB.post(`/api/orders/${orderA.id}/cancel`, { reason: 'hack attempt' })).status).toBe(404);
    expect((await ownerB.post(`/api/orders/${orderA.id}/payments`, { payments: [{ method: 'CASH', amount: 1 }] })).status).toBe(404);
    expect((await ownerB.get(`/api/documents/invoice/${orderA.id}`)).status).toBe(404);
    const listB = await ownerB.get('/api/customers?q=Secret');
    expect(listB.json.customers).toHaveLength(0);
    const ordersB = await ownerB.get('/api/orders');
    expect(ordersB.json.orders.find((o: any) => o.id === orderA.id)).toBeUndefined();
    // Order numbers overlap between shops, so a scan in B finds B's order (or nothing) — never A's.
    const scan = await ownerB.post('/api/tracking/scan', { code: `${orderA.orderNo}-1`, mode: 'lookup' });
    expect(scan.status).toBe(404);
    // B's order with B's customer ids cannot reference A's customer.
    const catB = await catalog(ownerB);
    const cross = await ownerB.post('/api/orders', {
      customerId: custA.id,
      items: [{ itemTypeId: catB.item('thobe'), serviceTypeId: catB.service('Wash & Iron'), quantity: 1 }],
    });
    expect(cross.status).toBe(404);
    // B cannot use A's catalog ids either.
    const crossItem = await ownerB.post('/api/orders', {
      items: [{ itemTypeId: catA.item('thobe'), serviceTypeId: catA.service('Wash & Iron'), quantity: 1 }],
    });
    expect(crossItem.status).toBe(400);
    const plB = await ownerB.get('/api/reports/sales-by-day');
    expect(plB.json.tables[0].totals.orders).toBe(0);
    const dashB = await ownerB.get('/api/dashboard');
    expect(dashB.json.today.orders).toBe(0);
  });
});

describe('Super admin and subscriptions', () => {
  it('manages tenants without seeing their data unless support access is granted', async () => {
    const shop = await createShop(env.prisma);
    const admin = await new Client(env.app).login(null, 'admin@newmux.test', 'AdminPass123!');
    const list = await admin.get('/api/platform/tenants');
    expect(list.status).toBe(200);
    const t = list.json.tenants.find((x: any) => x.slug === shop.slug);
    expect(t.usage.users).toBe(4);
    expect(t.revenue).toBeUndefined();
    // No tenant data through tenant routes.
    expect((await admin.get('/api/customers')).status).toBe(403);
    expect((await admin.post(`/api/platform/tenants/${t.id}/support-session`)).status).toBe(403);

    const owner = await loginAs(env.app, shop.slug, 'owner');
    expect((await owner.post('/api/settings/support-access', { days: 2 })).status).toBe(200);
    expect((await admin.post(`/api/platform/tenants/${t.id}/support-session`)).status).toBe(200);
    expect((await admin.get('/api/customers')).status).toBe(200);
    const me = await admin.get('/api/auth/me');
    expect(me.json.supportMode).toBe(true);
    // A shop user can never reach the platform panel.
    expect((await owner.get('/api/platform/tenants')).status).toBe(403);
  });

  it('expired subscription → read-only mode; suspended → cannot log in', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    await env.prisma.tenant.update({ where: { id: shop.tenant.id }, data: { trialEndsAt: new Date(Date.now() - 86400000) } });
    const me = await owner.get('/api/auth/me');
    expect(me.json.subscription.readOnly).toBe(true);
    expect((await owner.get('/api/customers')).status).toBe(200);
    const w = await owner.post('/api/customers', { name: 'X', mobile: '33445566' });
    expect(w.status).toBe(402);
    expect(w.json.error.code).toBe('READ_ONLY');

    const admin = await new Client(env.app).login(null, 'admin@newmux.test', 'AdminPass123!');
    expect((await admin.post(`/api/platform/tenants/${shop.tenant.id}/renew`, { months: 1 })).status).toBe(200);
    expect((await owner.post('/api/customers', { name: 'X', mobile: '33445566' })).status).toBe(200);

    expect((await admin.patch(`/api/platform/tenants/${shop.tenant.id}`, { status: 'SUSPENDED' })).status).toBe(200);
    expect((await owner.get('/api/auth/me')).json.user).toBeNull();
    const login = await new Client(env.app).post('/api/auth/login', { shopCode: shop.slug, identifier: 'owner', password: 'password123' });
    expect(login.status).toBe(403);
  });

  it('enforces the plan user limit and the advanced-permissions add-on', async () => {
    const shop = await createShop(env.prisma, { planCode: 'starter' });
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const roles = (await owner.get('/api/settings/roles')).json;
    expect(roles.canCustomize).toBe(false);
    const cr = roles.roles.find((r: any) => r.key === 'CASHIER');
    expect((await owner.put(`/api/settings/roles/${cr.id}`, { permissions: cr.permissions })).status).toBe(402);
    // starter = 3 users; the shop already has 4
    const u = await owner.post('/api/users', { name: 'Extra', username: 'extra', password: 'password123', roleId: cr.id });
    expect(u.status).toBe(402);
    expect(u.json.error.code).toBe('USER_LIMIT');
  });
});

describe('PIN switching on a shared counter device', () => {
  it('lets a trusted device switch user with a 4-digit PIN', async () => {
    const shop = await createShop(env.prisma);
    const device = await loginAs(env.app, shop.slug, 'owner');
    const users = await device.get('/api/auth/pin-users');
    expect(users.json.users.length).toBe(4);
    const cashier = users.json.users.find((u: any) => u.name === 'cashier');
    expect((await device.post('/api/auth/pin', { userId: cashier.id, pin: '9999' })).status).toBe(401);
    expect((await device.post('/api/auth/pin', { userId: cashier.id, pin: '3333' })).status).toBe(200);
    expect((await device.get('/api/auth/me')).json.role.key).toBe('CASHIER');
    // A device that never signed in with a password cannot use PINs.
    const stranger = new Client(env.app);
    expect((await stranger.post('/api/auth/pin', { userId: cashier.id, pin: '3333' })).status).toBe(401);
  });
});

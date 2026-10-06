/**
 * Order / money / staff workflows beyond the headline acceptance criteria.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, bhDate } from '@laundry/shared';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_WORKING_HOURS, parseSettings } from '@laundry/shared';
import { tenantDb } from '../src/lib/tenant-db';
import { generateRecurringExpenses } from '../src/modules/finance.service';
import { expirePackages } from '../src/modules/wallet.service';
import { Client, catalog, createShop, loginAs, setupApp, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => {
  await env.app.close();
  await env.prisma.$disconnect();
});

function multipart(filename: string, contentType: string, content: Buffer | string) {
  const boundary = '----lmsTestBoundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), Buffer.isBuffer(content) ? content : Buffer.from(content), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(c: Client, url: string, filename: string, type: string, content: Buffer | string) {
  const mp = multipart(filename, type, content);
  const res = await env.app.inject({
    method: 'POST',
    url,
    payload: mp.body,
    headers: { 'content-type': mp.contentType, cookie: Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  return { status: res.statusCode, json: res.json() };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('order lifecycle', () => {
  it('parks an order without a number, then receives it', async () => {
    const shop = await createShop(env.prisma);
    const c = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(c);
    const parked = await c.post('/api/orders', { park: true, items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 2 }] });
    expect(parked.status).toBe(200);
    expect(parked.json.order.orderNo).toBeNull();
    expect(parked.json.order.status).toBe('DRAFT');
    expect((await c.get('/api/orders/drafts')).json.drafts).toHaveLength(1);
    const done = await c.post('/api/orders', { draftId: parked.json.order.id, items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 3 }] });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json.order.id).toBe(parked.json.order.id);
    expect(done.json.order.orderNo).toBeGreaterThan(1000);
    expect(done.json.order.pieceCount).toBe(3);
    expect((await c.get('/api/orders/drafts')).json.drafts).toHaveLength(0);
  });

  it('edits an order before processing, not after', async () => {
    const shop = await createShop(env.prisma);
    const c = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(c);
    const o = (await c.post('/api/orders', { items: [{ itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Wash & Iron'), quantity: 2 }] })).json.order;
    const edited = await c.put(`/api/orders/${o.id}`, {
      items: [
        { itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Wash & Iron'), quantity: 2 },
        { itemTypeId: cat.item('tie'), serviceTypeId: cat.service('Iron Only'), quantity: 1 },
      ],
    });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect(edited.json.order.pieceCount).toBe(3);
    expect(edited.json.order.orderNo).toBe(o.orderNo);
    await c.post(`/api/orders/${o.id}/advance`, {});
    const late = await c.put(`/api/orders/${o.id}`, { items: [{ itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Wash & Iron'), quantity: 1 }] });
    expect(late.status).toBe(409);
  });

  it('uses express prices / surcharge and an earlier ready time', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cat = await catalog(owner);
    await owner.put('/api/catalog/prices', { itemTypeId: cat.item('suit'), serviceTypeId: cat.service('Dry Clean'), price: 2, expressPrice: 3 });
    const normal = (await owner.post('/api/orders', { items: [{ itemTypeId: cat.item('suit'), serviceTypeId: cat.service('Dry Clean'), quantity: 1 }] })).json.order;
    const express = (await owner.post('/api/orders', { express: true, items: [{ itemTypeId: cat.item('suit'), serviceTypeId: cat.service('Dry Clean'), quantity: 1 }] })).json.order;
    expect(normal.subtotal).toBe(2);
    expect(express.subtotal).toBe(3);
    expect(express.expressSurcharge).toBe(1.5); // default 50% surcharge on top
    expect(new Date(express.expectedAt).getTime()).toBeLessThan(new Date(normal.expectedAt).getTime());
    const audit = (await owner.get('/api/audit?action=price.changed')).json.logs;
    expect(audit[0].oldValue.price).toBe(2);
    expect(audit[0].newValue.expressPrice).toBe(3);
  });

  it('holds block scanning; delivery needs payment; partial pickup works', async () => {
    const shop = await createShop(env.prisma);
    const c = await loginAs(env.app, shop.slug, 'cashier');
    const cat = await catalog(c);
    const o = (
      await c.post('/api/orders', {
        items: [
          { itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Wash Only'), quantity: 2 },
          { itemTypeId: cat.item('trousers'), serviceTypeId: cat.service('Wash Only'), quantity: 1 },
        ],
      })
    ).json.order;
    await c.post(`/api/orders/${o.id}/hold`, { onHold: true, reason: 'Stain approval' });
    const blocked = await c.post('/api/tracking/scan', { code: `${o.orderNo}-1` });
    expect(blocked.status).toBe(409);
    await c.post(`/api/orders/${o.id}/hold`, { onHold: false });
    await c.post(`/api/orders/${o.id}/advance`, {});
    const ready = await c.post(`/api/orders/${o.id}/advance`, {});
    expect(ready.json.to).toBe('READY');
    const unpaid = await c.post(`/api/orders/${o.id}/deliver`, { pieceNos: [1, 2] });
    expect(unpaid.status).toBe(409);
    expect(unpaid.json.error.code).toBe('BALANCE_DUE');
    const part = await c.post(`/api/orders/${o.id}/deliver`, { pieceNos: [1, 2], payments: [{ method: 'CARD', amount: o.total }] });
    expect(part.status, JSON.stringify(part.json)).toBe(200);
    expect(part.json.remaining).toBe(1);
    expect(part.json.order.partiallyDelivered).toBe(true);
    expect(part.json.order.status).toBe('READY');
    const rest = await c.post(`/api/orders/${o.id}/deliver`, {});
    expect(rest.json.order.status).toBe('DELIVERED');
    expect(rest.json.order.deliveredByName).toBe('cashier');
  });

  it('board moves clamp to each piece’s own workflow', async () => {
    const shop = await createShop(env.prisma);
    const c = await loginAs(env.app, shop.slug, 'manager');
    const cat = await catalog(c);
    const o = (
      await c.post('/api/orders', {
        items: [
          { itemTypeId: cat.item('towel'), serviceTypeId: cat.service('Wash Only'), quantity: 1 },
          { itemTypeId: cat.item('shirt'), serviceTypeId: cat.service('Wash & Iron'), quantity: 1 },
        ],
      })
    ).json.order;
    const r = await c.post(`/api/orders/${o.id}/status`, { status: 'IRONING' });
    const pieces = r.json.order.items.flatMap((i: any) => i.pieces.map((p: any) => ({ item: i.itemName, status: p.status })));
    expect(pieces.find((p: any) => p.item === 'Towel').status).toBe('READY');
    expect(pieces.find((p: any) => p.item === 'Shirt').status).toBe('IRONING');
    expect(r.json.order.status).toBe('IRONING');
  });
});

describe('refunds', () => {
  it('cancelling a balance-paid order returns paid and bonus credit and reverses revenue', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cat = await catalog(owner);
    const cust = (await owner.post('/api/customers', { name: 'W', mobile: '36000001' })).json.customer;
    const pkg = cat.packages.find((p) => p.kind === 'CREDIT' && Number(p.price) === 20)!;
    await owner.post('/api/wallet/topup', { customerId: cust.id, packageId: pkg.id, method: 'CASH' });
    const o = (
      await owner.post('/api/orders', {
        customerId: cust.id,
        items: [{ itemTypeId: cat.item('thobe'), serviceTypeId: cat.service('Wash & Iron'), quantity: 5 }],
        payments: [{ method: 'WALLET', amount: 2.2 }],
      })
    ).json.order;
    const cancel = await owner.post(`/api/orders/${o.id}/cancel`, { reason: 'Customer request', refundMode: 'ORIGINAL' });
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);
    expect(cancel.json.order.status).toBe('CANCELLED');
    const c = (await owner.get(`/api/customers/${cust.id}`)).json.customer;
    expect(c.walletPaid).toBe(20);
    expect(c.walletBonus).toBe(5);
    const pl = await owner.get(`/api/reports/profit-loss?from=${bhDate()}&to=${bhDate()}`);
    expect(pl.json.tables[0].totals.gross).toBe(0);
    const audit = (await owner.get('/api/audit?action=order.cancelled')).json.logs;
    expect(audit[0].note).toBe('Customer request');
  });

  it('refunds paid credit in cash but never bonus credit', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cat = await catalog(owner);
    const cust = (await owner.post('/api/customers', { name: 'R', mobile: '36000002' })).json.customer;
    const pkg = cat.packages.find((p) => p.kind === 'CREDIT' && Number(p.price) === 20)!;
    await owner.post('/api/wallet/topup', { customerId: cust.id, packageId: pkg.id, method: 'CASH' });
    expect((await owner.post('/api/wallet/refund', { customerId: cust.id, amount: 21, method: 'CASH', reason: 'Leaving' })).status).toBe(400);
    const ok = await owner.post('/api/wallet/refund', { customerId: cust.id, amount: 20, method: 'CASH', reason: 'Leaving' });
    expect(ok.status).toBe(200);
    const cash = (await owner.get('/api/finance/cash')).json.summary;
    expect(cash.cashTopups).toBe(20);
    expect(cash.cashRefunds).toBe(20);
  });
});

describe('background jobs', () => {
  it('generates recurring expenses (e.g. monthly rent) up to today', async () => {
    const shop = await createShop(env.prisma);
    const db = tenantDb(env.prisma, shop.tenant.id);
    const cat = await db.expenseCategory.findFirstOrThrow({ where: { name: 'Rent' } });
    const start = addDays(bhDate(), -65);
    await db.recurringExpense.create({ data: { tenantId: shop.tenant.id, categoryId: cat.id, amount: 300, frequency: 'MONTHLY', anchorDay: Number(start.slice(8)), nextDate: start } });
    const ctx = {
      tenantId: shop.tenant.id,
      userId: 'system',
      userName: 'System',
      settings: parseSettings({}),
      perms: DEFAULT_ROLE_PERMISSIONS.OWNER,
      workingHours: DEFAULT_WORKING_HOURS,
      roleKey: null,
    };
    const created = await generateRecurringExpenses(db, ctx);
    expect(created).toBeGreaterThanOrEqual(2);
    expect(created).toBeLessThanOrEqual(3);
    expect(await generateRecurringExpenses(db, ctx)).toBe(0);
    const r = await db.recurringExpense.findFirstOrThrow({});
    expect(r.nextDate > bhDate()).toBe(true);
  });

  it('expires the unused bonus of an expired credit package', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cat = await catalog(owner);
    const pkg = await owner.post('/api/catalog/packages', { name: 'Promo 10→15', kind: 'CREDIT', price: 10, creditValue: 15, validityDays: 30 });
    const cust = (await owner.post('/api/customers', { name: 'E', mobile: '36000003' })).json.customer;
    await owner.post('/api/wallet/topup', { customerId: cust.id, packageId: pkg.json.package.id, method: 'CASH' });
    void cat;
    const db = tenantDb(env.prisma, shop.tenant.id);
    await db.customerPackage.updateMany({ where: { customerId: cust.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const ctx = { tenantId: shop.tenant.id, userId: 'system', userName: 'System', settings: parseSettings({}), perms: DEFAULT_ROLE_PERMISSIONS.OWNER, workingHours: DEFAULT_WORKING_HOURS, roleKey: null };
    const n = await db.$transaction((tx) => expirePackages(tx, ctx));
    expect(n).toBe(1);
    const c = (await owner.get(`/api/customers/${cust.id}`)).json.customer;
    expect(c.walletPaid).toBe(10);
    expect(c.walletBonus).toBe(0);
  });
});

describe('customers import/export and files', () => {
  it('imports customers from CSV, skipping duplicates and bad rows', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    await owner.post('/api/customers', { name: 'Existing', mobile: '33000100' });
    const csv = 'Name,Mobile,Type,Area,Opening Balance\nAli,33000101,Individual,Riffa,5\nHotel X,17000102,Company,Seef,\nExisting,33000100,,,\n,33000103,,,\nBad,12,,,\n';
    const r = await upload(owner, '/api/customers/import', 'c.csv', 'text/csv', csv);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.created).toBe(2);
    expect(r.json.skipped).toBe(1);
    expect(r.json.errors).toHaveLength(2);
    const ali = (await owner.get('/api/customers?q=Ali')).json.customers[0];
    expect(ali.walletPaid).toBe(5);
    const x = await owner.get('/api/customers/export?format=csv');
    expect(x.status).toBe(200);
    expect(x.raw.body).toContain('Hotel X');
    const xl = await owner.get('/api/customers/export?format=xlsx');
    expect(xl.raw.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('serves uploaded files only to the owning shop', async () => {
    const a = await createShop(env.prisma);
    const b = await createShop(env.prisma);
    const ca = await loginAs(env.app, a.slug, 'cashier');
    const cb = await loginAs(env.app, b.slug, 'cashier');
    const up = await upload(ca, '/api/files/upload/damage', 'stain.png', 'image/png', PNG);
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    expect((await ca.get(`/api/files/${up.json.id}`)).status).toBe(200);
    expect((await cb.get(`/api/files/${up.json.id}`)).status).toBe(404);
    const bad = await upload(ca, '/api/files/upload/damage', 'x.html', 'text/html', '<script>');
    expect(bad.status).toBe(400);
  });

  it('exports all shop data for the owner only', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const manager = await loginAs(env.app, shop.slug, 'manager');
    const x = await owner.get('/api/export/all');
    expect(x.status).toBe(200);
    expect(x.raw.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await manager.get('/api/export/all')).status).toBe(403);
  });
});

describe('self-onboarding', () => {
  it('signs up a new laundry on a trial with a starter price list', async () => {
    const c = new Client(env.app);
    const slug = `signup${Date.now().toString(36)}`;
    const r = await c.post('/api/onboarding/signup', {
      shop: { name: 'New Shop', slug, vatNumber: '220000000000009', phone: '17000000' },
      owner: { name: 'Owner', username: 'boss', password: 'password123' },
      template: 'dry_cleaner',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const me = await c.get('/api/auth/me');
    expect(me.json.role.key).toBe('OWNER');
    expect(me.json.subscription.state).toBe('TRIAL');
    const cat = await c.get('/api/catalog/pos');
    expect(cat.json.items.length).toBeGreaterThan(5);
    expect((await new Client(env.app).get(`/api/onboarding/check-slug?slug=${slug}`)).json.available).toBe(false);
    const dup = await new Client(env.app).post('/api/onboarding/signup', {
      shop: { name: 'Dup', slug },
      owner: { name: 'Other owner', username: 'o12', password: 'password123' },
    });
    expect(dup.status).toBe(409);
  });
});

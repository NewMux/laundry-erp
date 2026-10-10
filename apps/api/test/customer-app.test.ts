/**
 * Customer app API (/api/v1): sign-in, joining a shop, pre-orders that become
 * real orders when the shop has the clothes, pickup & delivery, addresses,
 * packages, wallet accounting and isolation between shops and customers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { addDays, bhDate } from '@laundry/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { tenantDb } from '../src/lib/tenant-db';
import { ensurePlans } from '../src/seed/tenant-setup';
import { Client, catalog, createShop, loginAs, uniq } from './helpers';

const OTP = '424242';
let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  app = await buildApp(prisma, loadConfig({ isTest: true, customerOtpDevCode: OTP }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function v1(method: InjectOptions['method'], url: string, body?: unknown, token?: string) {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    payload: body === undefined ? undefined : (body as object),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const json = String(res.headers['content-type'] ?? '').includes('json') ? res.json() : null;
  return { status: res.statusCode, json, headers: res.headers };
}

let phoneSeq = 0;
const newPhone = () => `+9733${String(Date.now() % 1000).padStart(3, '0')}${String(phoneSeq++ % 10000).padStart(4, '0')}`;

/** A shop with the customer app on, as configured by its owner. */
async function appShop(customerApp: Record<string, unknown> = {}) {
  const shop = await createShop(prisma);
  const owner = await loginAs(app, shop.slug, 'owner');
  const current = (await owner.get('/api/settings')).json.settings;
  const saved = await owner.put('/api/settings/preferences', { ...current, customerApp: { ...current.customerApp, enabled: true, ...customerApp } });
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  const code: string = saved.json.customerCode;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  return { ...shop, owner, code, cat: await catalog(owner) };
}

async function signIn(code: string, phone = newPhone()) {
  expect((await v1('POST', '/auth/otp', { phone, laundryCode: code })).status).toBe(200);
  const r = await v1('POST', '/auth/verify', { phone, laundryCode: code, otp: OTP });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { token: r.json.session.token as string, laundryId: r.json.laundry.id as string, phone, isNew: r.json.isNewCustomer as boolean };
}

const tomorrow = () => addDays(bhDate(), 1);

describe('customer app: joining a shop', () => {
  it('finds a shop only once its owner turns the app on, by its customer code', async () => {
    const shop = await createShop(prisma);
    const db = tenantDb(prisma, shop.tenant.id);
    expect((await db.tenant.findUnique({ where: { id: shop.tenant.id } }))?.customerCode).toBeNull();
    const on = await appShop();
    const r = await v1('GET', `/laundries/by-code/${on.code.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(on.code);
    expect(r.json.currency.decimals).toBe(3);
    expect(r.json.vatBps).toBe(1000);
    // Area-priced items are measured at the counter, so the app doesn't list them.
    expect(r.json.garments.some((g: { name: { en: string } }) => g.name.en.startsWith('Carpet'))).toBe(false);
    const thobe = r.json.garments.find((g: { name: { en: string } }) => g.name.en === 'Thobe');
    expect(thobe.prices[on.cat.service('Wash & Iron')]).toBe(400);
    expect(r.json.serviceNames[on.cat.service('Wash & Iron')].en).toBe('Wash & Iron');
    expect((await v1('GET', '/laundries/by-code/ZZZZZZ')).status).toBe(404);
  });

  it('signs in with a one-time code and links to the shop customer with the same mobile', async () => {
    const shop = await appShop();
    const phone = newPhone();
    const known = await shop.owner.post('/api/customers', { name: 'Fatima Ali', mobile: phone });
    expect(known.status, JSON.stringify(known.json)).toBe(200);
    await shop.owner.post('/api/wallet/topup', { customerId: known.json.customer.id, amount: 5, method: 'CASH' });

    await v1('POST', '/auth/otp', { phone, laundryCode: shop.code });
    const wrong = await v1('POST', '/auth/verify', { phone, laundryCode: shop.code, otp: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.code).toBe('invalid_otp');

    const s = await signIn(shop.code, phone);
    expect(s.isNew).toBe(false); // the shop already knew Fatima
    const m = await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token);
    expect(m.json.customerId).toBe(known.json.customer.id);
    expect(m.json.walletBalance).toBe(5000);
  });

  it('creates a new shop customer for a new number, who then gives a name', async () => {
    const shop = await appShop();
    const s = await signIn(shop.code);
    expect(s.isNew).toBe(true);
    expect((await v1('PATCH', `/laundries/${s.laundryId}/profile`, { name: 'Hassan' }, s.token)).status).toBe(200);
    const db = tenantDb(prisma, shop.tenant.id);
    const c = await db.customer.findFirst({ where: { mobile: s.phone.replace('+', '') } });
    expect(c?.name).toBe('Hassan');
  });

  it('refuses requests without a valid session', async () => {
    const shop = await appShop();
    expect((await v1('GET', `/laundries/${shop.tenant.id}/membership`)).status).toBe(401);
    expect((await v1('GET', `/laundries/${shop.tenant.id}/membership`, undefined, 'nope')).status).toBe(401);
  });

  it('answers browser preflight requests for the app API', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/api/v1/laundries/by-code/ABCDEF', headers: { origin: 'https://example.com' } });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('customer app: orders', () => {
  it('places a drop-off order as a pre-order, then the shop receives it and the wallet is charged', async () => {
    const shop = await appShop();
    const phone = newPhone();
    const known = await shop.owner.post('/api/customers', { name: 'Ali', mobile: phone });
    await shop.owner.post('/api/wallet/topup', { customerId: known.json.customer.id, amount: 10, method: 'CASH' });
    const s = await signIn(shop.code, phone);
    const lines = [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 2, note: 'Light starch' }];
    const handover = { inbound: 'dropoff', outbound: 'collect' };

    const q = await v1('POST', `/laundries/${s.laundryId}/quote`, { lines, express: false, handover }, s.token);
    expect(q.status, JSON.stringify(q.json)).toBe(200);
    expect(q.json.totals).toMatchObject({ subtotal: 800, driverFee: 0, vat: 80, total: 880 });

    const placed = await v1(
      'POST',
      `/laundries/${s.laundryId}/orders`,
      { lines, express: false, handover, notes: 'Hang please', paymentMethod: 'wallet', idempotencyKey: uniq('key'), expectedTotal: 880 },
      s.token,
    );
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    expect(placed.json.status).toBe('awaiting_dropoff');
    expect(placed.json.number).toMatch(/^A-[A-Z2-9]{6}$/);
    expect(placed.json.payment).toEqual({ method: 'wallet', status: 'due_on_receipt' });
    expect(placed.json.lines[0].note).toBe('Light starch');

    // Nothing charged and no invoice number yet; the staff inbox has it, the parked list doesn't.
    expect((await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).json.walletBalance).toBe(10000);
    const inbox = await shop.owner.get('/api/orders/app');
    expect(inbox.json.orders.map((o: { id: string }) => o.id)).toContain(placed.json.id);
    expect((await shop.owner.get('/api/orders/drafts')).json.drafts).toHaveLength(0);

    // Scanning the customer's pass at the counter finds it.
    const scan = await shop.owner.post('/api/tracking/scan', { code: placed.json.number, mode: 'order' });
    expect(scan.json.order.id).toBe(placed.json.id);

    const received = await shop.owner.post(`/api/orders/${placed.json.id}/receive-app`, {});
    expect(received.status, JSON.stringify(received.json)).toBe(200);
    expect(received.json.charged).toBe(true);
    expect(received.json.order.orderNo).toBeGreaterThan(1000);
    expect(received.json.order.paymentState).toBe('PAID');
    expect(received.json.order.pieceCount).toBe(2);

    const seen = await v1('GET', `/laundries/${s.laundryId}/orders/${placed.json.id}`, undefined, s.token);
    expect(seen.json.status).toBe('received');
    expect(seen.json.number).toBe(String(received.json.order.orderNo));
    expect(seen.json.payment.status).toBe('paid');
    expect(seen.json.pickupToken).toBe(`O${received.json.order.orderNo}`);
    expect((await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).json.walletBalance).toBe(10000 - 880);
    const txns = await v1('GET', `/laundries/${s.laundryId}/transactions`, undefined, s.token);
    expect(txns.json[0]).toMatchObject({ amount: -880, method: 'wallet' });
  });

  it('receives the order unpaid when the wallet no longer covers it', async () => {
    const shop = await appShop();
    const phone = newPhone();
    const known = await shop.owner.post('/api/customers', { name: 'Noor', mobile: phone });
    await shop.owner.post('/api/wallet/topup', { customerId: known.json.customer.id, amount: 1, method: 'CASH' });
    const s = await signIn(shop.code, phone);
    const placed = await v1(
      'POST',
      `/laundries/${s.laundryId}/orders`,
      { lines: [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 2 }], handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'wallet', idempotencyKey: uniq('k') },
      s.token,
    );
    expect(placed.status).toBe(200);
    // Spent at the counter in the meantime.
    await tenantDb(prisma, shop.tenant.id).customer.update({ where: { id: known.json.customer.id }, data: { walletPaid: 0.2 } });
    const received = await shop.owner.post(`/api/orders/${placed.json.id}/receive-app`, {});
    expect(received.json.charged).toBe(false);
    expect(received.json.order.paymentState).toBe('UNPAID');
  });

  it('rejects a wallet order the balance can’t cover, a changed price and an unknown item', async () => {
    const shop = await appShop();
    const s = await signIn(shop.code);
    const base = { lines: [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'collect' } };
    expect((await v1('POST', `/laundries/${s.laundryId}/orders`, { ...base, paymentMethod: 'wallet', idempotencyKey: uniq('k') }, s.token)).json.error.code).toBe('insufficient_funds');
    expect((await v1('POST', `/laundries/${s.laundryId}/orders`, { ...base, paymentMethod: 'cash_counter', idempotencyKey: uniq('k'), expectedTotal: 1 }, s.token)).json.error.code).toBe('price_changed');
    const bad = await v1('POST', `/laundries/${s.laundryId}/orders`, { ...base, lines: [{ garmentId: 'nope', service: 'nope', quantity: 1 }], paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(bad.json.error.code).toBe('invalid_order');
  });

  it('returns the same order when a placement is retried with the same key', async () => {
    const shop = await appShop();
    const s = await signIn(shop.code);
    const body = { lines: [{ garmentId: shop.cat.item('shirt'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('same') };
    const a = await v1('POST', `/laundries/${s.laundryId}/orders`, body, s.token);
    const b = await v1('POST', `/laundries/${s.laundryId}/orders`, body, s.token);
    expect(b.json.id).toBe(a.json.id);
    expect((await v1('GET', `/laundries/${s.laundryId}/orders`, undefined, s.token)).json).toHaveLength(1);
  });

  it('lets the customer cancel until the shop has the clothes, and keeps it out of the books', async () => {
    const shop = await appShop();
    const s = await signIn(shop.code);
    const placed = await v1(
      'POST',
      `/laundries/${s.laundryId}/orders`,
      { lines: [{ garmentId: shop.cat.item('shirt'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') },
      s.token,
    );
    const cancelled = await v1('POST', `/laundries/${s.laundryId}/orders/${placed.json.id}/cancel`, {}, s.token);
    expect(cancelled.json.status).toBe('cancelled');
    expect((await shop.owner.get('/api/orders/app?view=cancelled')).json.orders).toHaveLength(1);
    // No invoice number, so no sales, VAT or cancellations report entry.
    expect((await shop.owner.get('/api/orders')).json.orders).toHaveLength(0);
  });

  it('shows the customer their counter orders too, but never another customer’s', async () => {
    const shop = await appShop();
    const a = await signIn(shop.code);
    const b = await signIn(shop.code);
    const db = tenantDb(prisma, shop.tenant.id);
    const custA = await db.customer.findFirstOrThrow({ where: { mobile: a.phone.replace('+', '') } });
    const counter = await shop.owner.post('/api/orders', { customerId: custA.id, items: [{ itemTypeId: shop.cat.item('thobe'), serviceTypeId: shop.cat.service('Iron Only'), quantity: 3 }] });
    const list = await v1('GET', `/laundries/${a.laundryId}/orders`, undefined, a.token);
    expect(list.json.map((o: { id: string }) => o.id)).toEqual([counter.json.order.id]);
    expect(list.json[0]).toMatchObject({ status: 'received', handover: { inbound: 'dropoff', outbound: 'collect' } });
    expect((await v1('GET', `/laundries/${b.laundryId}/orders/${counter.json.order.id}`, undefined, b.token)).status).toBe(404);
  });

  it('keeps shops apart: a customer can’t use a shop they haven’t joined', async () => {
    const one = await appShop();
    const two = await appShop();
    const s = await signIn(one.code);
    expect((await v1('GET', `/laundries/${two.tenant.id}/membership`, undefined, s.token)).status).toBe(404);
    const joined = await v1('POST', '/laundries/join', { code: two.code }, s.token);
    expect(joined.status).toBe(200);
    expect(joined.json.membership.walletBalance).toBe(0);
  });
});

describe('customer app: pickup and delivery', () => {
  const setup = { pickup: { enabled: true, fee: 0.5 }, delivery: { enabled: true, fee: 0.5 }, roundTripFee: 0.8, freeAbove: 20 };

  async function withAddress(code: string) {
    const s = await signIn(code);
    const addr = await v1('POST', `/laundries/${s.laundryId}/addresses`, { label: 'Home', area: 'Riffa', block: '921', road: '2105', building: '77', notes: 'White gate' }, s.token);
    expect(addr.status, JSON.stringify(addr.json)).toBe(200);
    expect(addr.json.isDefault).toBe(true);
    return { ...s, addressId: addr.json.id as string };
  }

  it('charges the round-trip price with VAT and runs the driver steps through to delivery', async () => {
    const shop = await appShop(setup);
    const s = await withAddress(shop.code);
    const lines = [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 2 }];
    const handover = { inbound: 'pickup', outbound: 'delivery' };
    const pickupSlot = { date: tomorrow(), slotId: 'morning' };

    const noAddress = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines, handover, pickupSlot, deliverySlot: { date: addDays(tomorrow(), 3), slotId: 'evening' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(noAddress.json.error.code).toBe('invalid_order');
    // Wash & Iron takes 48 h after the pickup window ends: two days later is too early.
    const tooEarly = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines, handover, addressId: s.addressId, pickupSlot, deliverySlot: { date: addDays(tomorrow(), 1), slotId: 'evening' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(tooEarly.json.error.code).toBe('slot_unavailable');
    const past = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines, handover, addressId: s.addressId, pickupSlot: { date: addDays(bhDate(), -1), slotId: 'morning' }, deliverySlot: { date: addDays(tomorrow(), 4), slotId: 'evening' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(past.json.error.code).toBe('slot_unavailable');

    const placed = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines, handover, addressId: s.addressId, pickupSlot, deliverySlot: { date: addDays(tomorrow(), 3), slotId: 'evening' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    // 0.800 thobes + 0.800 round trip = 1.600 before VAT; 10% VAT → 1.760.
    expect(placed.json.totals).toMatchObject({ subtotal: 800, driverFee: 800, taxable: 1600, vat: 160, total: 1760 });
    expect(placed.json.status).toBe('awaiting_pickup');
    expect(placed.json.address).toMatchObject({ label: 'Home', notes: 'White gate' });
    expect(placed.json.pickupSlot.label.en).toBe('Morning');

    const id = placed.json.id as string;
    expect((await shop.owner.post(`/api/orders/${id}/handover`, { to: 'PICKUP_EN_ROUTE' })).status).toBe(200);
    expect((await v1('GET', `/laundries/${s.laundryId}/orders/${id}`, undefined, s.token)).json.status).toBe('pickup_en_route');
    // The driver has set off: too late for the customer to cancel.
    expect((await v1('POST', `/laundries/${s.laundryId}/orders/${id}/cancel`, {}, s.token)).status).toBe(409);

    const received = await shop.owner.post(`/api/orders/${id}/receive-app`, {});
    expect(received.json.order.total).toBe(1.76);
    expect(received.json.order.driverFee).toBe(0.8);
    await shop.owner.post(`/api/orders/${id}/status`, { status: 'READY' });
    expect((await shop.owner.post(`/api/orders/${id}/handover`, { to: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    expect((await shop.owner.get('/api/orders/app?view=deliveries')).json.orders.map((o: { id: string }) => o.id)).toContain(id);
    const out = await v1('GET', `/laundries/${s.laundryId}/orders/${id}`, undefined, s.token);
    expect(out.json.status).toBe('out_for_delivery');
    expect(Object.keys(out.json.timeline)).toEqual(expect.arrayContaining(['awaiting_pickup', 'pickup_en_route', 'received', 'ready', 'out_for_delivery']));

    // The driver collects payment on delivery.
    const delivered = await shop.owner.post(`/api/orders/${id}/deliver`, { payments: [{ method: 'CASH', amount: 1.76 }] });
    expect(delivered.status, JSON.stringify(delivered.json)).toBe(200);
    expect((await v1('GET', `/laundries/${s.laundryId}/orders/${id}`, undefined, s.token)).json.status).toBe('delivered');
  });

  it('charges one leg alone, and nothing above the free amount', async () => {
    const shop = await appShop(setup);
    const s = await withAddress(shop.code);
    const one = await v1('POST', `/laundries/${s.laundryId}/quote`, { lines: [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'delivery' } }, s.token);
    expect(one.json.totals.driverFee).toBe(500);
    const big = await v1('POST', `/laundries/${s.laundryId}/quote`, { lines: [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 50 }], handover: { inbound: 'pickup', outbound: 'delivery' } }, s.token);
    expect(big.json.totals.driverFee).toBe(0);
  });

  it('only offers what the shop set up', async () => {
    const shop = await appShop({ delivery: { enabled: true, fee: 1 } });
    const s = await withAddress(shop.code);
    const r = await v1('POST', `/laundries/${s.laundryId}/quote`, { lines: [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'pickup', outbound: 'collect' } }, s.token);
    expect(r.json.error.code).toBe('invalid_order');
    const laundry = await v1('GET', `/laundries/${s.laundryId}`, undefined, s.token);
    expect(laundry.json.fulfillment).toMatchObject({ counter: true, pickup: { enabled: false }, delivery: { enabled: true, fee: 1000 } });
  });

  it('keeps the driver fee when staff edit the pre-order at the counter', async () => {
    const shop = await appShop(setup);
    const s = await withAddress(shop.code);
    const placed = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines: [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'delivery' }, addressId: s.addressId, deliverySlot: { date: addDays(tomorrow(), 3), slotId: 'evening' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    const customerId = (await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).json.customerId;
    const edited = await shop.owner.put(`/api/orders/${placed.json.id}`, { customerId, items: [{ itemTypeId: shop.cat.item('thobe'), serviceTypeId: shop.cat.service('Wash & Iron'), quantity: 3 }] });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect(edited.json.order.driverFee).toBe(0.5);
    // 1.200 + 0.500 = 1.700 + 10% VAT
    expect(edited.json.order.total).toBe(1.87);
    expect(edited.json.order.source).toBe('APP');
  });

  it('edits, defaults and deletes addresses', async () => {
    const shop = await appShop(setup);
    const s = await withAddress(shop.code);
    const work = await v1('POST', `/laundries/${s.laundryId}/addresses`, { label: 'Work', area: 'Seef', block: '428', road: '2803', building: '1', isDefault: true, geo: { lat: 26.23, lng: 50.53 } }, s.token);
    expect(work.json.isDefault).toBe(true);
    let m = await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token);
    expect(m.json.addresses.filter((a: { isDefault: boolean }) => a.isDefault).map((a: { id: string }) => a.id)).toEqual([work.json.id]);
    expect(m.json.addresses[0].geo).toEqual({ lat: 26.23, lng: 50.53 });
    expect((await v1('DELETE', `/laundries/${s.laundryId}/addresses/${work.json.id}`, undefined, s.token)).status).toBe(204);
    m = await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token);
    expect(m.json.addresses).toHaveLength(1);
    expect(m.json.addresses[0].isDefault).toBe(true);
  });
});

describe('customer app: packages and account', () => {
  it('covers pieces with an item package, splitting a line, and uses it when received', async () => {
    const shop = await appShop();
    const phone = newPhone();
    const known = await shop.owner.post('/api/customers', { name: 'Maryam', mobile: phone });
    const pkg = await shop.owner.post('/api/catalog/packages', { name: '3 Thobes', kind: 'ITEMS', price: 1, itemCount: 3, itemTypeId: shop.cat.item('thobe'), serviceTypeId: shop.cat.service('Wash & Iron') });
    expect(pkg.status, JSON.stringify(pkg.json)).toBe(200);
    await shop.owner.post('/api/wallet/topup', { customerId: known.json.customer.id, packageId: pkg.json.package.id, method: 'CASH' });
    const s = await signIn(shop.code, phone);
    const m = await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token);
    expect(m.json.packages[0]).toMatchObject({ total: 3, remaining: 3, covers: { garmentId: shop.cat.item('thobe') } });

    const lines = [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 5 }];
    const q = await v1('POST', `/laundries/${s.laundryId}/quote`, { lines, handover: { inbound: 'dropoff', outbound: 'collect' } }, s.token);
    // 3 covered, 2 charged at 0.400.
    expect(q.json.lines.map((l: { quantity: number; coveredByPackage: number }) => [l.quantity, l.coveredByPackage])).toEqual([[3, 3], [2, 0]]);
    expect(q.json.totals.subtotal).toBe(800);

    const placed = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines, handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    await shop.owner.post(`/api/orders/${placed.json.id}/receive-app`, {});
    const after = await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token);
    expect(after.json.packages[0].remaining).toBe(0);
  });

  it('deletes the account only with nothing in progress; the shop keeps its customer and books', async () => {
    const shop = await appShop();
    const s = await signIn(shop.code);
    await v1('POST', `/laundries/${s.laundryId}/addresses`, { label: 'Home', area: 'Riffa', block: '1', road: '1', building: '1' }, s.token);
    const placed = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines: [{ garmentId: shop.cat.item('shirt'), service: shop.cat.service('Wash & Iron'), quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect((await v1('DELETE', '/account', undefined, s.token)).json.error.code).toBe('active_orders');
    await v1('POST', `/laundries/${s.laundryId}/orders/${placed.json.id}/cancel`, {}, s.token);
    expect((await v1('DELETE', '/account', undefined, s.token)).status).toBe(200);
    expect((await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).status).toBe(401);
    const db = tenantDb(prisma, shop.tenant.id);
    const c = await db.customer.findFirstOrThrow({ where: { mobile: s.phone.replace('+', '') } });
    expect(c.appUserId).toBeNull();
    expect(await db.customerAddress.count({ where: { customerId: c.id } })).toBe(0);
  });

  it('stops sign-in codes after too many requests', async () => {
    const shop = await appShop();
    const phone = newPhone();
    for (let i = 0; i < 5; i++) expect((await v1('POST', '/auth/otp', { phone, laundryCode: shop.code })).status).toBe(200);
    expect((await v1('POST', '/auth/otp', { phone, laundryCode: shop.code })).json.error.code).toBe('rate_limited');
  });
});

void Client;

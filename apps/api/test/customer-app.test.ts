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
import type { PushMessage, PushTicket } from '../src/lib/push';
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

describe('customer app: wallet top-up at the counter', () => {
  it('shows a top-up recorded by the cashier in the balance and the statement, with no payment flow in the app', async () => {
    const shop = await appShop();
    const phone = newPhone();
    const known = await shop.owner.post('/api/customers', { name: 'Layla', mobile: phone });
    const s = await signIn(shop.code, phone);
    expect((await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).json.walletBalance).toBe(0);

    const cashier = await loginAs(app, shop.slug, 'cashier');
    const top = await cashier.post('/api/wallet/topup', { customerId: known.json.customer.id, amount: 5, method: 'CASH' });
    expect(top.status, JSON.stringify(top.json)).toBe(200);

    expect((await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).json.walletBalance).toBe(5000);
    const txns = await v1('GET', `/laundries/${s.laundryId}/transactions`, undefined, s.token);
    expect(txns.json[0]).toMatchObject({ amount: 5000, method: 'cash_counter', title: { en: 'Top-up' } });
    // The app never takes money itself: its top-up endpoint stays closed.
    const viaApp = await v1('POST', `/laundries/${s.laundryId}/wallet/top-ups`, { amount: 5000, idempotencyKey: uniq('key') }, s.token);
    expect(viaApp.status).toBe(409);
  });

  it('records a retried top-up once and audits it', async () => {
    const shop = await appShop();
    const cust = (await shop.owner.post('/api/customers', { name: 'Retry', mobile: newPhone() })).json.customer;
    const key = uniq('topup-key');
    const first = await shop.owner.post('/api/wallet/topup', { customerId: cust.id, amount: 5, method: 'CASH', idempotencyKey: key });
    const again = await shop.owner.post('/api/wallet/topup', { customerId: cust.id, amount: 5, method: 'CASH', idempotencyKey: key });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(first.json.replayed).toBe(false);
    expect(again.json.replayed).toBe(true);
    expect(again.json.paymentId).toBe(first.json.paymentId);
    expect(again.json.receipt.receiptNo).toBe(first.json.receipt.receiptNo);
    expect((await shop.owner.get(`/api/customers/${cust.id}`)).json.customer.walletPaid).toBe(5);

    // The same key cannot be reused for a different top-up.
    const other = await shop.owner.post('/api/wallet/topup', { customerId: cust.id, amount: 7, method: 'CASH', idempotencyKey: key });
    expect(other.status).toBe(409);
    expect(other.json.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const logs = (await shop.owner.get('/api/audit?action=wallet.topup')).json.logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].entityId).toBe(cust.id);
  });

  it('lets a manager cancel a mistaken top-up once, takes the credit and the cash back, and the app shows it', async () => {
    const shop = await appShop();
    const phone = newPhone();
    const cust = (await shop.owner.post('/api/customers', { name: 'Mistake', mobile: phone })).json.customer;
    const s = await signIn(shop.code, phone);
    const cashier = await loginAs(app, shop.slug, 'cashier');
    const manager = await loginAs(app, shop.slug, 'manager');
    const top = await cashier.post('/api/wallet/topup', { customerId: cust.id, amount: 50, method: 'CASH' });
    expect((await shop.owner.get('/api/finance/cash')).json.summary.cashTopups).toBe(50);

    // A cashier can record but not cancel.
    expect((await cashier.post(`/api/wallet/topup/${top.json.paymentId}/void`, { reason: 'Typed 50 not 5' })).status).toBe(403);
    expect((await manager.post(`/api/wallet/topup/${top.json.paymentId}/void`, { reason: 'x' })).status).toBe(400);

    const voided = await manager.post(`/api/wallet/topup/${top.json.paymentId}/void`, { reason: 'Typed 50 not 5' });
    expect(voided.status, JSON.stringify(voided.json)).toBe(200);
    expect(voided.json.balance).toBe(0);
    expect((await shop.owner.get(`/api/customers/${cust.id}`)).json.customer.walletPaid).toBe(0);
    expect((await shop.owner.get('/api/finance/cash')).json.summary.cashTopups).toBe(0);

    const history = (await shop.owner.get(`/api/customers/${cust.id}/wallet`)).json.transactions;
    expect(history.find((x: { type: string }) => x.type === 'TOPUP').voided).toBe(true);
    expect(history[0].type).toBe('TOPUP_VOID');

    const txns = await v1('GET', `/laundries/${s.laundryId}/transactions`, undefined, s.token);
    expect(txns.json[0]).toMatchObject({ amount: -50000, title: { en: 'Top-up cancelled' } });
    expect((await v1('GET', `/laundries/${s.laundryId}/membership`, undefined, s.token)).json.walletBalance).toBe(0);

    const twice = await manager.post(`/api/wallet/topup/${top.json.paymentId}/void`, { reason: 'Again' });
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe('ALREADY_VOIDED');
    const logs = (await shop.owner.get('/api/audit?action=wallet.void_topup')).json.logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].note).toBe('Typed 50 not 5');
  });

  it('refuses to cancel a top-up the customer has already spent, and a package sale', async () => {
    const shop = await appShop();
    const cust = (await shop.owner.post('/api/customers', { name: 'Spender', mobile: newPhone() })).json.customer;
    const top = await shop.owner.post('/api/wallet/topup', { customerId: cust.id, amount: 3, method: 'CASH' });
    const order = await shop.owner.post('/api/orders', {
      customerId: cust.id,
      items: [{ itemTypeId: shop.cat.item('thobe'), serviceTypeId: shop.cat.service('Wash & Iron'), quantity: 5 }],
      payments: [{ method: 'WALLET', amount: 2.2 }],
    });
    expect(order.status, JSON.stringify(order.json)).toBe(200);
    const spent = await shop.owner.post(`/api/wallet/topup/${top.json.paymentId}/void`, { reason: 'Mistake' });
    expect(spent.status).toBe(400);
    expect(spent.json.error.code).toBe('TOPUP_SPENT');
    expect((await shop.owner.get(`/api/customers/${cust.id}`)).json.customer.walletPaid).toBeCloseTo(0.8, 3);

    const pkg = shop.cat.packages.find((p) => p.kind === 'CREDIT')!;
    const sale = await shop.owner.post('/api/wallet/topup', { customerId: cust.id, packageId: pkg.id, method: 'CASH' });
    const notTopup = await shop.owner.post(`/api/wallet/topup/${sale.json.paymentId}/void`, { reason: 'Mistake' });
    expect(notTopup.status).toBe(400);
    expect(notTopup.json.error.code).toBe('NOT_VOIDABLE');
  });
});

describe('customer app: item photos', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

  async function uploadItemPhoto(owner: Client, itemId: string) {
    const boundary = '----lmsItemPhoto';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="thobe.png"\r\nContent-Type: image/png\r\n\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/catalog/items/${itemId}/image`,
      payload: Buffer.concat([Buffer.from(head), PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        cookie: Object.entries(owner.cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  const fetchPhoto = (path: string, token?: string) =>
    app.inject({ method: 'GET', url: `/api${path}`, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('shows the owner’s photo to the shop’s customers, and only to them', async () => {
    const shop = await appShop();
    const itemId = shop.cat.item('thobe');
    await uploadItemPhoto(shop.owner, itemId);

    const s = await signIn(shop.code);
    const laundry = (await v1('GET', `/laundries/${s.laundryId}`, undefined, s.token)).json;
    const withPhoto = laundry.garments.find((g: any) => g.id === itemId);
    const without = laundry.garments.find((g: any) => g.id === shop.cat.item('shirt'));
    expect(withPhoto.imageUrl).toMatch(new RegExp(`^/v1/laundries/${s.laundryId}/items/${itemId}/image\\?v=`));
    expect(withPhoto.icon).toBe('thobe');
    expect(without.imageUrl).toBeUndefined();

    const img = await fetchPhoto(withPhoto.imageUrl, s.token);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('private');
    expect(img.rawPayload.equals(PNG)).toBe(true);

    expect((await fetchPhoto(withPhoto.imageUrl)).statusCode).toBe(401);
    const stranger = await signIn((await appShop()).code);
    expect((await fetchPhoto(withPhoto.imageUrl, stranger.token)).statusCode).toBe(404);
    expect((await fetchPhoto(`/v1/laundries/${s.laundryId}/items/${shop.cat.item('shirt')}/image`, s.token)).statusCode).toBe(404);
  });

  it('keeps the photo on the order lines the customer sees afterwards, and changes the URL when the photo is replaced', async () => {
    const shop = await appShop();
    const itemId = shop.cat.item('thobe');
    await uploadItemPhoto(shop.owner, itemId);
    const s = await signIn(shop.code);
    const before = (await v1('GET', `/laundries/${s.laundryId}`, undefined, s.token)).json.garments.find((g: any) => g.id === itemId).imageUrl;

    const wi = shop.cat.service('Wash & Iron');
    const placed = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines: [{ garmentId: itemId, service: wi, quantity: 1 }], handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    expect(placed.json.lines[0].imageUrl).toBe(before);

    await uploadItemPhoto(shop.owner, itemId);
    const after = (await v1('GET', `/laundries/${s.laundryId}`, undefined, s.token)).json.garments.find((g: any) => g.id === itemId).imageUrl;
    expect(after).not.toBe(before);
  });
});

describe("customer app: I'm outside", () => {
  const lines = (shop: Awaited<ReturnType<typeof appShop>>) => [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 2 }];
  async function readyOrder(shop: Awaited<ReturnType<typeof appShop>>, s: Awaited<ReturnType<typeof signIn>>) {
    const placed = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines: lines(shop), handover: { inbound: 'dropoff', outbound: 'collect' }, paymentMethod: 'cash_counter', idempotencyKey: uniq('k') }, s.token);
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    const id: string = placed.json.id;
    // Not ready yet: nothing to bring out (or the shop doesn't offer it at all).
    expect((await v1('POST', `/laundries/${s.laundryId}/orders/${id}/arrival`, { plate: '12345' }, s.token)).status).toBe(409);
    const received = await shop.owner.post(`/api/orders/${id}/receive-app`, {});
    expect(received.status).toBe(200);
    expect((await shop.owner.post(`/api/orders/${id}/status`, { status: 'READY' })).status).toBe(200);
    return { id, total: received.json.order.total as number };
  }
  const outside = async (shop: Awaited<ReturnType<typeof appShop>>) =>
    (await shop.owner.get('/api/orders/app?view=outside')).json.orders as { id: string; curbsidePlate: string; customer: { name: string } }[];

  it('tells the shop the customer is waiting in the car, and clears once the order is handed over', async () => {
    const shop = await appShop({ curbside: true });
    expect((await v1('GET', `/laundries/by-code/${shop.code}`)).json.fulfillment.curbside).toBe(true);
    const s = await signIn(shop.code);
    const { id, total } = await readyOrder(shop, s);

    const told = await v1('POST', `/laundries/${s.laundryId}/orders/${id}/arrival`, { plate: ' ٤٥-١٢٣ ' }, s.token);
    expect(told.status, JSON.stringify(told.json)).toBe(200);
    expect(told.json.status).toBe('ready');
    expect(told.json.arrival.plate).toBe('45 123');
    expect(Date.now() - Date.parse(told.json.arrival.at)).toBeLessThan(60_000);

    // Staff see it under App orders → Outside, and on the order's history.
    const waiting = await outside(shop);
    expect(waiting.map((o) => [o.id, o.curbsidePlate])).toEqual([[id, '45 123']]);
    const detail = await shop.owner.get(`/api/orders/${id}`);
    expect(detail.json.order.curbsidePlate).toBe('45 123');
    expect(detail.json.order.events.some((e: { type: string; note: string }) => e.type === 'CURBSIDE' && e.note.includes('45 123'))).toBe(true);

    // Sending it again changes the car.
    expect((await v1('POST', `/laundries/${s.laundryId}/orders/${id}/arrival`, { plate: 'abc 987' }, s.token)).json.arrival.plate).toBe('ABC 987');
    expect((await outside(shop))[0].curbsidePlate).toBe('ABC 987');

    // Handed over at the car as usual: no longer outside, and the app stops showing it.
    const delivered = await shop.owner.post(`/api/orders/${id}/deliver`, { payments: [{ method: 'CASH', amount: total }] });
    expect(delivered.status, JSON.stringify(delivered.json)).toBe(200);
    expect(await outside(shop)).toEqual([]);
    const done = await v1('GET', `/laundries/${s.laundryId}/orders/${id}`, undefined, s.token);
    expect(done.json.status).toBe('delivered');
    expect(done.json.arrival).toBeUndefined();
    expect((await v1('POST', `/laundries/${s.laundryId}/orders/${id}/arrival`, { plate: '12345' }, s.token)).json.error.code).toBe('invalid_order');
  });

  it('stops counting the customer as outside after two hours', async () => {
    const shop = await appShop({ curbside: true });
    const s = await signIn(shop.code);
    const { id } = await readyOrder(shop, s);
    expect((await v1('POST', `/laundries/${s.laundryId}/orders/${id}/arrival`, { plate: '55555' }, s.token)).status).toBe(200);
    await tenantDb(prisma, shop.tenant.id).order.update({ where: { id }, data: { curbsideAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 60_000) } });
    expect(await outside(shop)).toEqual([]);
    expect((await v1('GET', `/laundries/${s.laundryId}/orders/${id}`, undefined, s.token)).json.arrival).toBeUndefined();
  });

  it('is off unless the shop turns it on, needs a car number, and only works on the customer’s own order', async () => {
    const off = await appShop();
    expect((await v1('GET', `/laundries/by-code/${off.code}`)).json.fulfillment.curbside).toBe(false);
    const a = await signIn(off.code);
    const { id } = await readyOrder(off, a);
    expect((await v1('POST', `/laundries/${a.laundryId}/orders/${id}/arrival`, { plate: '12345' }, a.token)).json.error.code).toBe('not_available');

    const on = await appShop({ curbside: true });
    const mine = await signIn(on.code);
    const other = await signIn(on.code);
    const order = await readyOrder(on, mine);
    expect((await v1('POST', `/laundries/${mine.laundryId}/orders/${order.id}/arrival`, { plate: 'ABC' }, mine.token)).json.error.code).toBe('invalid_order');
    expect((await v1('POST', `/laundries/${other.laundryId}/orders/${order.id}/arrival`, { plate: '12345' }, other.token)).status).toBe(404);
    expect(await outside(on)).toEqual([]);
  });
});

describe('customer app: push notifications', () => {
  let sent: PushMessage[] = [];
  let answer: (m: PushMessage) => PushTicket = () => ({ status: 'ok' });
  beforeAll(() => {
    app.config.pushSend = async (messages) => {
      sent.push(...messages);
      return messages.map((m) => answer(m));
    };
  });
  afterAll(() => {
    app.config.pushSend = undefined;
  });
  const reset = () => {
    sent = [];
    answer = () => ({ status: 'ok' });
  };
  let tokenSeq = 0;
  const pushToken = () => `ExponentPushToken[test${Date.now().toString(36)}${tokenSeq++}abc]`;
  const lines = (shop: Awaited<ReturnType<typeof appShop>>) => [{ garmentId: shop.cat.item('thobe'), service: shop.cat.service('Wash & Iron'), quantity: 1 }];
  const place = async (shop: Awaited<ReturnType<typeof appShop>>, s: Awaited<ReturnType<typeof signIn>>, handover = { inbound: 'dropoff', outbound: 'collect' }, extra: Record<string, unknown> = {}) => {
    const r = await v1('POST', `/laundries/${s.laundryId}/orders`, { lines: lines(shop), handover, paymentMethod: 'cash_counter', idempotencyKey: uniq('k'), ...extra }, s.token);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.id as string;
  };

  it('tells the customer when the shop has the order and when it is ready, in their language', async () => {
    reset();
    const shop = await appShop({ curbside: true });
    await tenantDb(prisma, shop.tenant.id).tenant.update({ where: { id: shop.tenant.id }, data: { nameAr: 'مغسلة الاختبار' } });
    const s = await signIn(shop.code);
    const en = pushToken();
    const ar = pushToken();
    expect((await v1('POST', '/push-tokens', { token: en, platform: 'ios', lang: 'en' }, s.token)).status).toBe(200);
    expect((await v1('POST', '/push-tokens', { token: ar, platform: 'android', lang: 'ar' }, s.token)).status).toBe(200);

    const id = await place(shop, s);
    // Placing it is the customer's own action: nothing to tell them.
    expect(sent).toEqual([]);

    const received = await shop.owner.post(`/api/orders/${id}/receive-app`, {});
    const no = String(received.json.order.orderNo);
    expect(sent.map((m) => [m.to, m.title])).toEqual([
      [en, 'We have your order'],
      [ar, 'استلمنا طلبك'],
    ]);
    expect(sent[0]).toMatchObject({ data: { orderId: id, laundryId: shop.tenant.id }, sound: 'default', channelId: 'orders' });
    expect(sent[0].body).toContain(`order ${no}`);
    expect(sent[1].body).toContain('مغسلة الاختبار');

    sent = [];
    await shop.owner.post(`/api/orders/${id}/status`, { status: 'READY' });
    expect(sent.map((m) => m.title)).toEqual(['Ready to collect', 'جاهز للاستلام']);
    expect(sent[0].body).toBe(`Order ${no} is ready at ${shop.tenant.name}. Coming by car? Tap I’m outside when you arrive.`);
    expect(sent[1].body).toContain('أنا بالخارج');

    // Already ready: setting it again says nothing new.
    sent = [];
    await shop.owner.post(`/api/orders/${id}/status`, { status: 'READY' });
    expect(sent).toEqual([]);
  });

  it('announces the driver on the way and a delivery leaving, not a delivery order being ready', async () => {
    reset();
    const shop = await appShop({ pickup: { enabled: true, fee: 0.5 }, delivery: { enabled: true, fee: 0.5 } });
    const s = await signIn(shop.code);
    await v1('POST', '/push-tokens', { token: pushToken(), platform: 'ios' }, s.token);
    const address = await v1('POST', `/laundries/${s.laundryId}/addresses`, { label: 'Home', area: 'Riffa', block: '921', road: '2105', building: '12' }, s.token);
    const id = await place(shop, s, { inbound: 'pickup', outbound: 'delivery' }, {
      addressId: address.json.id,
      pickupSlot: { date: tomorrow(), slotId: 'morning' },
      deliverySlot: { date: addDays(tomorrow(), 3), slotId: 'evening' },
    });

    await shop.owner.post(`/api/orders/${id}/handover`, { to: 'PICKUP_EN_ROUTE' });
    expect(sent.map((m) => m.title)).toEqual(['Driver on the way']);
    sent = [];
    await shop.owner.post(`/api/orders/${id}/receive-app`, {});
    await shop.owner.post(`/api/orders/${id}/status`, { status: 'READY' });
    expect(sent.map((m) => m.title)).toEqual(['We have your order']);
    sent = [];
    await shop.owner.post(`/api/orders/${id}/handover`, { to: 'OUT_FOR_DELIVERY' });
    expect(sent.map((m) => m.title)).toEqual(['On its way']);
  });

  it('tells the customer when the shop cancels, but not when they cancel themselves', async () => {
    reset();
    const shop = await appShop();
    const s = await signIn(shop.code);
    await v1('POST', '/push-tokens', { token: pushToken(), platform: 'ios' }, s.token);
    const mine = await place(shop, s);
    expect((await v1('POST', `/laundries/${s.laundryId}/orders/${mine}/cancel`, {}, s.token)).status).toBe(200);
    expect(sent).toEqual([]);

    const theirs = await place(shop, s);
    const cancelled = await shop.owner.post(`/api/orders/${theirs}/cancel`, { reason: 'Closed for Eid' });
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    expect(sent.map((m) => m.title)).toEqual(['Order cancelled']);
  });

  it('sends nothing when the staff action fails', async () => {
    reset();
    const shop = await appShop();
    const s = await signIn(shop.code);
    await v1('POST', '/push-tokens', { token: pushToken(), platform: 'ios' }, s.token);
    const id = await place(shop, s);
    // A dropped-off order has no driver step.
    expect((await shop.owner.post(`/api/orders/${id}/handover`, { to: 'PICKUP_EN_ROUTE' })).status).toBe(409);
    expect(sent).toEqual([]);
  });

  it('keeps one owner per phone, forgets a phone that signed out or removed the app, and checks the token', async () => {
    reset();
    const shop = await appShop();
    const a = await signIn(shop.code);
    const b = await signIn(shop.code);
    const token = pushToken();
    expect((await v1('POST', '/push-tokens', { token: 'not-a-token', platform: 'ios' }, a.token)).status).toBe(400);
    expect((await v1('POST', '/push-tokens', { token, platform: 'ios' })).status).toBe(401);
    await v1('POST', '/push-tokens', { token, platform: 'ios' }, a.token);
    // Someone else signs in on the same phone: it's theirs now.
    await v1('POST', '/push-tokens', { token, platform: 'ios' }, b.token);
    const owner = await prisma.appPushToken.findUnique({ where: { token }, include: { appUser: true } });
    expect(owner?.appUser.phone).toBe(b.phone.replace('+', ''));

    // A can't remove B's phone; B can.
    expect((await v1('DELETE', `/push-tokens/${encodeURIComponent(token)}`, undefined, a.token)).status).toBe(204);
    expect(await prisma.appPushToken.count({ where: { token } })).toBe(1);
    expect((await v1('DELETE', `/push-tokens/${encodeURIComponent(token)}`, undefined, b.token)).status).toBe(204);
    expect(await prisma.appPushToken.count({ where: { token } })).toBe(0);

    // Apple says the app is gone: the token is dropped after the send.
    const gone = pushToken();
    await v1('POST', '/push-tokens', { token: gone, platform: 'ios' }, b.token);
    answer = () => ({ status: 'error', details: { error: 'DeviceNotRegistered' } });
    const id = await place(shop, b);
    await shop.owner.post(`/api/orders/${id}/receive-app`, {});
    expect(sent.map((m) => m.to)).toEqual([gone]);
    expect(await prisma.appPushToken.count({ where: { token: gone } })).toBe(0);
  });

  it('removes the phones with the account', async () => {
    reset();
    const shop = await appShop();
    const s = await signIn(shop.code);
    const token = pushToken();
    await v1('POST', '/push-tokens', { token, platform: 'ios' }, s.token);
    expect((await v1('DELETE', '/account', undefined, s.token)).status).toBe(200);
    expect(await prisma.appPushToken.count({ where: { token } })).toBe(0);
  });
});

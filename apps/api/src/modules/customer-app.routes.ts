import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeMobile, isValidMobile } from '@laundry/shared';
import { createAppSession, issueOtp, requireAppUser, verifyOtp } from '../lib/app-auth';
import { scopedDb } from '../lib/context';
import { AppError } from '../lib/errors';
import { parse } from '../lib/validate';
import { ORDER_INCLUDE, addressDto, fils, itemLooks, laundryDto, orderDto, packageDto, transactionDto } from './customer-app.dto';
import {
  assertWritable,
  cancelByCustomer,
  deleteAccount,
  deleteAddress,
  joinShop,
  memberOf,
  placeOrder,
  pricedDto,
  quote,
  saveAddress,
  tenantByCode,
  type Member,
} from './customer-app.service';

/**
 * The customer app's API (/api/v1). Bearer-token auth, JSON, errors as
 * { error: { code, message } } with the app's lower-case codes. Every call
 * after sign-in is scoped to one shop the customer has joined.
 */
export default async function customerAppRoutes(app: FastifyInstance) {
  const prisma = app.prisma;
  const member = async (req: FastifyRequest): Promise<Member> => {
    const user = await requireAppUser(prisma, req);
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), req.params);
    return memberOf(prisma, user, id);
  };
  const phoneOf = (raw: string) => {
    const phone = normalizeMobile(raw);
    if (!isValidMobile(phone)) throw new AppError(400, 'invalid_phone', 'Enter a valid mobile number');
    return phone;
  };

  async function membership(m: Member) {
    const [customer, packages, addresses] = await Promise.all([
      m.db.customer.findFirstOrThrow({ where: { id: m.customer.id } }),
      m.db.customerPackage.findMany({ where: { customerId: m.customer.id, kind: 'ITEMS' }, orderBy: { createdAt: 'desc' } }),
      m.db.customerAddress.findMany({ where: { customerId: m.customer.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      laundryId: m.tenant.id,
      customerId: customer.id,
      walletBalance: fils(customer.walletPaid) + fils(customer.walletBonus),
      walletBonus: fils(customer.walletBonus),
      packages: packages.map(packageDto),
      addresses: addresses.map(addressDto),
    };
  }

  async function loadOrder(m: Member, orderId: string) {
    const o = await m.db.order.findFirst({ where: { id: orderId, customerId: m.customer.id, status: { not: 'DRAFT' } }, include: ORDER_INCLUDE });
    const draft = o ? null : await m.db.order.findFirst({ where: { id: orderId, customerId: m.customer.id, source: 'APP' }, include: ORDER_INCLUDE });
    const found = o ?? draft;
    if (!found) throw new AppError(404, 'not_found', 'Order not found');
    return orderDto(found, found.payments, await itemLooks(m.db, [found]));
  }

  // ── Public ──────────────────────────────────────────────

  app.get('/laundries/by-code/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { code } = parse(z.object({ code: z.string().min(1).max(20) }), req.params);
    const tenant = await tenantByCode(prisma, code);
    return laundryDto(scopedDb(prisma, tenant.id), tenant);
  });

  app.post('/auth/otp', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ phone: z.string().min(6).max(20), laundryCode: z.string().min(1).max(20) }), req.body);
    await tenantByCode(prisma, body.laundryCode);
    return issueOtp(app, phoneOf(body.phone));
  });

  app.post('/auth/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ phone: z.string().min(6).max(20), laundryCode: z.string().min(1).max(20), otp: z.string().min(4).max(8) }), req.body);
    const phone = phoneOf(body.phone);
    const tenant = await tenantByCode(prisma, body.laundryCode);
    await verifyOtp(prisma, phone, body.otp);
    const user = await prisma.appUser.upsert({ where: { phone }, update: {}, create: { phone } });
    const { customer } = await joinShop(prisma, user, tenant);
    // A shop that already knows this customer by name fills in the account's name.
    let name = user.name;
    if (!name && customer.name && customer.name !== `+${phone}` && !customer.name.startsWith('+')) {
      name = customer.name;
      await prisma.appUser.update({ where: { id: user.id }, data: { name } });
    }
    const token = await createAppSession(prisma, user.id);
    return {
      session: { token, phone: `+${phone}`, name },
      isNewCustomer: !name,
      laundry: await laundryDto(scopedDb(prisma, tenant.id), tenant),
    };
  });

  // ── Account ─────────────────────────────────────────────

  app.post('/laundries/join', async (req) => {
    const user = await requireAppUser(prisma, req);
    const { code } = parse(z.object({ code: z.string().min(1).max(20) }), req.body);
    const tenant = await tenantByCode(prisma, code);
    await joinShop(prisma, user, tenant);
    const m = await memberOf(prisma, user, tenant.id);
    return { laundry: await laundryDto(m.db, tenant), membership: await membership(m) };
  });

  app.patch('/laundries/:id/profile', async (req) => {
    const m = await member(req);
    const { name } = parse(z.object({ name: z.string().trim().min(2).max(60) }), req.body);
    await prisma.appUser.update({ where: { id: req.appUser!.id }, data: { name } });
    // The name is the customer's own; update it at every shop they joined.
    await prisma.customer.updateMany({ where: { appUserId: req.appUser!.id }, data: { name } });
    void m;
    return { ok: true };
  });

  app.delete('/account', async (req) => {
    const user = await requireAppUser(prisma, req);
    await deleteAccount(prisma, user);
    return { ok: true };
  });

  // ── Shop ────────────────────────────────────────────────

  app.get('/laundries/:id', async (req) => {
    const m = await member(req);
    return laundryDto(m.db, m.tenant);
  });

  app.get('/laundries/:id/membership', async (req) => membership(await member(req)));

  app.get('/laundries/:id/transactions', async (req) => {
    const m = await member(req);
    const txns = await m.db.walletTransaction.findMany({ where: { customerId: m.customer.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const paymentIds = txns.map((t) => t.paymentId).filter((x): x is string => !!x);
    const orderIds = txns.map((t) => t.orderId).filter((x): x is string => !!x);
    const [payments, orders] = await Promise.all([
      m.db.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, method: true } }),
      m.db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } }),
    ]);
    const pay = new Map(payments.map((p) => [p.id, p]));
    const nos = new Map(orders.map((o) => [o.id, o.orderNo]));
    return txns.map((t) => transactionDto(t, t.paymentId ? pay.get(t.paymentId) : undefined, t.orderId ? nos.get(t.orderId) : null));
  });

  // Online top-ups need a payment gateway, which isn't connected: top up at the counter.
  app.post('/laundries/:id/wallet/top-ups', async (req) => {
    await member(req);
    throw new AppError(409, 'not_available', 'Online top-up is not available yet. Top up at the laundry counter.');
  });

  // ── Orders ──────────────────────────────────────────────

  const lineSchema = z.object({
    garmentId: z.string().min(1).max(64),
    service: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(200),
    note: z.string().max(140).nullish(),
  });
  const handoverSchema = z
    .object({ inbound: z.enum(['dropoff', 'pickup']), outbound: z.enum(['collect', 'delivery']) })
    .transform((h) => ({ inbound: h.inbound === 'pickup' ? ('PICKUP' as const) : ('DROPOFF' as const), outbound: h.outbound === 'delivery' ? ('DELIVERY' as const) : ('COLLECT' as const) }));
  const quoteSchema = z.object({
    lines: z.array(lineSchema).min(1).max(100),
    express: z.boolean().default(false),
    handover: handoverSchema,
  });
  const slotSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slotId: z.string().min(1).max(20) });

  app.get('/laundries/:id/orders', async (req) => {
    const m = await member(req);
    const orders = await m.db.order.findMany({
      where: { customerId: m.customer.id, OR: [{ status: { not: 'DRAFT' } }, { source: 'APP' }] },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const looks = await itemLooks(m.db, orders);
    return orders.map((o) => orderDto(o, o.payments, looks));
  });

  app.get('/laundries/:id/orders/:orderId', async (req) => {
    const m = await member(req);
    const { orderId } = parse(z.object({ orderId: z.string().min(1).max(64) }), req.params);
    return loadOrder(m, orderId);
  });

  app.post('/laundries/:id/quote', async (req) => {
    const m = await member(req);
    const body = parse(quoteSchema, req.body);
    return pricedDto(m, await quote(m, body), body.handover);
  });

  app.post('/laundries/:id/orders', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const m = await member(req);
    const body = parse(
      quoteSchema.extend({
        addressId: z.string().max(64).nullish(),
        pickupSlot: slotSchema.nullish(),
        deliverySlot: slotSchema.nullish(),
        notes: z.string().max(500).default(''),
        paymentMethod: z.enum(['wallet', 'card_counter', 'cash_counter', 'benefitpay']),
        idempotencyKey: z.string().min(8).max(100),
        expectedTotal: z.number().int().min(0).nullish(),
      }),
      req.body,
    );
    const id = await placeOrder(m, body);
    return loadOrder(m, id);
  });

  app.post('/laundries/:id/orders/:orderId/cancel', async (req) => {
    const m = await member(req);
    assertWritable(m);
    const { orderId } = parse(z.object({ orderId: z.string().min(1).max(64) }), req.params);
    await cancelByCustomer(m, orderId);
    return loadOrder(m, orderId);
  });

  // ── Addresses ───────────────────────────────────────────

  const addressSchema = z.object({
    label: z.string().trim().min(1).max(30),
    area: z.string().trim().min(1).max(80),
    block: z.string().trim().min(1).max(10),
    road: z.string().trim().min(1).max(10),
    building: z.string().trim().min(1).max(20),
    flat: z.string().trim().max(20).nullish(),
    notes: z.string().trim().max(200).nullish(),
    geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
    isDefault: z.boolean().optional(),
  });

  app.post('/laundries/:id/addresses', async (req) => {
    const m = await member(req);
    return addressDto(await saveAddress(m, parse(addressSchema, req.body)));
  });

  app.put('/laundries/:id/addresses/:addressId', async (req) => {
    const m = await member(req);
    const { addressId } = parse(z.object({ addressId: z.string().min(1).max(64) }), req.params);
    return addressDto(await saveAddress(m, { ...parse(addressSchema, req.body), id: addressId }));
  });

  app.delete('/laundries/:id/addresses/:addressId', async (req, reply) => {
    const m = await member(req);
    const { addressId } = parse(z.object({ addressId: z.string().min(1).max(64) }), req.params);
    await deleteAddress(m, addressId);
    return reply.status(204).send();
  });
}

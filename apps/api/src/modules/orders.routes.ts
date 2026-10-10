import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DAMAGE_TYPES,
  addBhd,
  PIECE_STATUSES,
  can,
  endOfDay,
  fillTemplate,
  formatBhd,
  fmtDateTime,
  hasCap,
  startOfDay,
  whatsappLink,
  type PrintOrder,
} from '@laundry/shared';
import { anyPerm, audit, perm, requireTenant } from '../lib/context';
import { signToken } from '../lib/crypto';
import { AppError, forbidden, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { ctxOf } from '../lib/service-context';
import type { TenantDb } from '../lib/tenant-db';
import { parse, zDate, zMoney, zOptStr } from '../lib/validate';
import {
  advanceOrder,
  applyOrderPayments,
  cancelOrder,
  createOrder,
  deliverOrder,
  receiveAppOrder,
  refreshPaymentState,
  setHandoverStatus,
  setHold,
  setOrderStatus,
  updateOrder,
  type OrderInput,
} from './orders.service';

const lineSchema = z.object({
  itemTypeId: z.string().min(1),
  serviceTypeId: z.string().min(1),
  quantity: z.number().int().min(1).max(500),
  area: z.number().min(0).max(10000).nullish(),
  unitPrice: zMoney.nullish(),
  discountType: z.enum(['AMOUNT', 'PERCENT']).nullish(),
  discountValue: z.number().min(0).max(100000).nullish(),
  color: zOptStr(60),
  brand: zOptStr(60),
  notes: zOptStr(300),
  damage: z.array(z.enum(DAMAGE_TYPES)).max(10).default([]),
  damageNotes: zOptStr(300),
  damagePhotoIds: z.array(z.string()).max(5).default([]),
  customerPackageId: z.string().nullish(),
});

const paymentSchema = z.object({
  method: z.enum(['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER', 'WALLET']),
  amount: zMoney,
  reference: zOptStr(100),
});

const orderSchema = z.object({
  customerId: z.string().nullish(),
  express: z.boolean().default(false),
  items: z.array(lineSchema).min(1).max(200),
  orderDiscountType: z.enum(['AMOUNT', 'PERCENT']).nullish(),
  orderDiscountValue: z.number().min(0).max(100000).nullish(),
  notes: zOptStr(500),
  expectedAt: z.coerce.date().nullish(),
});

const createSchema = orderSchema.extend({
  park: z.boolean().default(false),
  draftId: z.string().nullish(),
  payments: z.array(paymentSchema).max(6).default([]),
  onAccount: z.boolean().default(false),
});

export const ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  onHold: true,
  holdReason: true,
  express: true,
  expectedAt: true,
  total: true,
  paidAmount: true,
  balanceDue: true,
  paymentState: true,
  onAccount: true,
  pieceCount: true,
  partiallyDelivered: true,
  createdAt: true,
  readyAt: true,
  deliveredAt: true,
  createdByName: true,
  source: true,
  appRef: true,
  inbound: true,
  outbound: true,
  handoverStatus: true,
  pickupSlot: true,
  deliverySlot: true,
  customer: { select: { id: true, name: true, mobile: true } },
} satisfies Prisma.OrderSelect;

/** Remove prices / phone numbers the current user may not see. */
export function redactOrder<T extends Record<string, unknown>>(req: FastifyRequest, o: T): T {
  const a = requireTenant(req);
  const out: Record<string, unknown> = { ...o };
  if (!hasCap(a.perms, 'viewPrices')) {
    for (const k of ['subtotal', 'lineDiscountTotal', 'expressSurcharge', 'orderDiscount', 'orderDiscountValue', 'discountTotal', 'netAmount', 'vatAmount', 'total', 'paidAmount', 'balanceDue', 'payments']) {
      delete out[k];
    }
    if (Array.isArray(out.items)) {
      out.items = (out.items as Record<string, unknown>[]).map((it) => {
        const { unitPrice, discountAmount, discountValue, grossAmount, lineTotal, ...rest } = it;
        void unitPrice, discountAmount, discountValue, grossAmount, lineTotal;
        return rest;
      });
    }
    // Event notes of money events carry amounts.
    if (Array.isArray(out.events)) {
      out.events = (out.events as Record<string, unknown>[]).map((e) =>
        ['PAYMENT', 'EDITED', 'REFUND', 'CANCELLED'].includes(String(e.type)) ? { ...e, note: null } : e,
      );
    }
    if (out.customer && typeof out.customer === 'object') {
      const c = { ...(out.customer as Record<string, unknown>) };
      for (const k of ['walletPaid', 'walletBonus', 'creditLimit', 'creditEnabled']) delete c[k];
      out.customer = c;
    }
  }
  if (!hasCap(a.perms, 'viewCustomerPhone') && out.customer && typeof out.customer === 'object') {
    const c = { ...(out.customer as Record<string, unknown>) };
    delete c.mobile;
    delete c.altPhone;
    out.customer = c;
  }
  return out as T;
}

export function receiptToken(secret: string, tenantId: string, orderId: string) {
  return signToken(secret, { t: tenantId, o: orderId, k: 'r' });
}

export async function loadOrderDetail(db: TenantDb, id: string) {
  return db.order.findFirst({
    where: { id },
    include: {
      customer: {
        select: { id: true, name: true, mobile: true, altPhone: true, walletPaid: true, walletBonus: true, creditEnabled: true, creditLimit: true, type: true },
      },
      items: { orderBy: { lineNo: 'asc' }, include: { pieces: { orderBy: { pieceNo: 'asc' } } } },
      payments: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 100 },
    },
  });
}

/** Data for printing the 80mm receipt and the item tags. */
export async function buildPrintOrder(app: FastifyInstance, db: TenantDb, tenantId: string, orderId: string): Promise<PrintOrder> {
  const o = await loadOrderDetail(db, orderId);
  if (!o || o.orderNo === null) throw notFound('Order');
  const pieces = o.items.flatMap((it) => it.pieces.map((p) => ({ pieceNo: p.pieceNo, itemName: it.itemName, serviceName: it.serviceName, color: it.color })));
  pieces.sort((a, b) => a.pieceNo - b.pieceNo);
  const byMethod = new Map<string, number>();
  for (const p of o.payments) {
    if (p.kind !== 'ORDER' && p.kind !== 'REFUND') continue;
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + num(p.amount));
  }
  return {
    orderNo: o.orderNo,
    createdAt: o.createdAt.toISOString(),
    expectedAt: o.expectedAt?.toISOString() ?? null,
    express: o.express,
    cashierName: o.createdByName,
    customer: o.customer ? { name: o.customer.name, mobile: o.customer.mobile } : null,
    items: o.items.map((it) => ({
      lineNo: it.lineNo,
      itemName: it.itemName,
      serviceName: it.serviceName,
      unit: it.unit,
      quantity: it.quantity,
      area: it.area === null ? null : num(it.area),
      unitPrice: num(it.unitPrice),
      discountAmount: num(it.discountAmount),
      lineTotal: num(it.lineTotal),
      color: it.color,
      brand: it.brand,
      notes: it.notes,
      damage: it.damage,
      damageNotes: it.damageNotes,
      coveredByPackage: !!it.customerPackageId,
    })),
    pieces,
    subtotal: num(o.subtotal),
    discountTotal: num(o.discountTotal),
    expressSurcharge: num(o.expressSurcharge),
    vatRate: num(o.vatRate),
    vatAmount: num(o.vatAmount),
    netAmount: num(o.netAmount),
    total: num(o.total),
    paidAmount: num(o.paidAmount),
    balanceDue: num(o.balanceDue),
    onAccount: o.onAccount,
    payments: [...byMethod.entries()].map(([method, amount]) => ({ method: method as PrintOrder['payments'][number]['method'], amount })),
    walletBalance: o.customer ? addBhd(num(o.customer.walletPaid), num(o.customer.walletBonus)) : null,
    notes: o.notes,
    qrLink: `${app.config.publicUrl}/api/documents/public/receipt/${receiptToken(app.config.appSecret, tenantId, o.id)}`,
    status: o.status,
  };
}

export default async function ordersRoutes(app: FastifyInstance) {
  const viewAny = anyPerm(['pos', 'view'], ['tracking', 'view'], ['delivery', 'view']);

  const listSchema = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.string().optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    express: z.enum(['1', 'true']).optional(),
    overdue: z.enum(['1', 'true']).optional(),
    unpaid: z.enum(['1', 'true']).optional(),
    onHold: z.enum(['1', 'true']).optional(),
    customerId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  });

  app.get('/', { preHandler: viewAny }, async (req) => {
    const q = parse(listSchema, req.query);
    const db = app.tdb(req);
    const where: Prisma.OrderWhereInput = { orderNo: { not: null } };
    const and: Prisma.OrderWhereInput[] = [];
    if (q.status) {
      const list = q.status.split(',').filter((s) => s);
      where.status = { in: list as never };
    }
    if (q.from) and.push({ createdAt: { gte: startOfDay(q.from) } });
    if (q.to) and.push({ createdAt: { lt: endOfDay(q.to) } });
    if (q.express) where.express = true;
    if (q.onHold) where.onHold = true;
    if (q.customerId) where.customerId = q.customerId;
    if (q.overdue) {
      and.push({ expectedAt: { lt: new Date() }, status: { in: ['RECEIVED', 'IN_PROCESS', 'IRONING'] } });
    }
    if (q.unpaid) and.push({ balanceDue: { gt: 0 }, status: { not: 'CANCELLED' } });
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      const or: Prisma.OrderWhereInput[] = [{ customer: { name: { contains: q.q, mode: 'insensitive' } } }];
      if (/^\d+$/.test(q.q) && q.q.length <= 9) or.push({ orderNo: Number(q.q) });
      if (digits.length >= 4 && hasCap(req.auth!.perms, 'viewCustomerPhone')) or.push({ customer: { mobile: { contains: digits } } });
      and.push({ OR: or });
    }
    if (and.length) where.AND = and;
    const [orders, total] = await Promise.all([
      db.order.findMany({ where, select: ORDER_LIST_SELECT, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.order.count({ where }),
    ]);
    return { orders: orders.map((o) => redactOrder(req, o)), total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/drafts', { preHandler: perm('pos', 'create') }, async (req) => {
    const drafts = await app.tdb(req).order.findMany({
      where: { status: 'DRAFT', source: 'COUNTER' },
      select: { id: true, createdAt: true, updatedAt: true, total: true, pieceCount: true, express: true, createdByName: true, customer: { select: { id: true, name: true, mobile: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return { drafts };
  });

  /**
   * Customer-app inbox: pre-orders waiting to be dropped off or collected, and
   * orders to deliver. "done" lists app orders already received or cancelled.
   */
  app.get('/app', { preHandler: viewAny }, async (req) => {
    const q = parse(z.object({ view: z.enum(['open', 'deliveries', 'cancelled']).default('open') }), req.query);
    const where: Prisma.OrderWhereInput =
      q.view === 'open'
        ? { source: 'APP', status: 'DRAFT' }
        : q.view === 'deliveries'
          ? { outbound: 'DELIVERY', status: { in: ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY'] } }
          : { source: 'APP', status: 'CANCELLED', orderNo: null };
    const orders = await app.tdb(req).order.findMany({
      where,
      select: { ...ORDER_LIST_SELECT, notes: true, address: true, items: { select: { itemName: true, quantity: true, notes: true } } },
      orderBy: q.view === 'cancelled' ? { cancelledAt: 'desc' } : { createdAt: 'asc' },
      take: 200,
    });
    return { orders: orders.map((o) => redactOrder(req, o)) };
  });

  app.get('/:id', { preHandler: viewAny }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const o = await loadOrderDetail(app.tdb(req), id);
    if (!o) throw notFound('Order');
    return { order: redactOrder(req, o) };
  });

  app.get('/no/:orderNo', { preHandler: viewAny }, async (req) => {
    const { orderNo } = parse(z.object({ orderNo: z.coerce.number().int() }), req.params);
    const db = app.tdb(req);
    const found = await db.order.findFirst({ where: { orderNo }, select: { id: true } });
    if (!found) throw notFound('Order');
    const o = await loadOrderDetail(db, found.id);
    return { order: redactOrder(req, o!) };
  });

  async function auditPricing(req: FastifyRequest, orderId: string, orderNo: number | null, input: OrderInput, before?: unknown) {
    const db = app.tdb(req);
    const o = await db.order.findFirstOrThrow({ where: { id: orderId }, include: { items: true } });
    if (num(o.discountTotal) > 0) {
      await audit(db, req, 'order.discount', 'order', orderId, before ?? null, {
        orderNo,
        discountTotal: num(o.discountTotal),
        orderDiscount: num(o.orderDiscount),
        lineDiscounts: o.items.filter((i) => num(i.discountAmount) > 0).map((i) => ({ line: i.lineNo, item: i.itemName, discount: num(i.discountAmount) })),
      });
    }
    const overridden = o.items.filter((i) => i.priceOverridden);
    if (overridden.length) {
      await audit(db, req, 'order.price_override', 'order', orderId, null, {
        orderNo,
        lines: overridden.map((i) => ({ line: i.lineNo, item: i.itemName, service: i.serviceName, price: num(i.unitPrice) })),
      });
    }
    void input;
  }

  app.post('/', { preHandler: perm('pos', 'create') }, async (req) => {
    const body = parse(createSchema, req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const { park, draftId, payments, onAccount, ...input } = body;
    if (onAccount && !body.customerId) throw new AppError(400, 'NO_CUSTOMER', 'Credit orders need a customer');
    const order = await db.$transaction((tx) => createOrder(tx, ctx, input, { park, draftId, payments, onAccount }), { timeout: 20000 });
    if (!park) await auditPricing(req, order.id, order.orderNo, input);
    const detail = await loadOrderDetail(db, order.id);
    return { order: redactOrder(req, detail!) };
  });

  app.put('/:id', { preHandler: perm('pos', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(orderSchema, req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const result = await db.$transaction((tx) => updateOrder(tx, ctx, id, input), { timeout: 20000 });
    if ('before' in result) {
      await audit(db, req, 'order.edited', 'order', id, { total: num(result.before.total), pieces: result.before.pieceCount }, { total: result.priced.totals.total, pieces: result.priced.pieceCount });
      await auditPricing(req, id, result.before.orderNo, input);
    }
    const detail = await loadOrderDetail(db, id);
    return { order: redactOrder(req, detail!) };
  });

  app.delete('/:id/draft', { preHandler: perm('pos', 'create') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const o = await db.order.findFirst({ where: { id } });
    if (!o || o.status !== 'DRAFT') throw notFound('Parked order');
    await db.order.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/:id/payments', { preHandler: anyPerm(['pos', 'create'], ['delivery', 'create']) }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ payments: z.array(paymentSchema).min(1).max(6) }), req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    await db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id } });
      if (!order) throw notFound('Order');
      if (order.status === 'DRAFT' || order.status === 'CANCELLED') throw new AppError(409, 'NOT_PAYABLE', 'This order cannot take payments');
      await applyOrderPayments(tx, ctx, order, body.payments);
      await refreshPaymentState(tx, id);
    });
    const detail = await loadOrderDetail(db, id);
    return { order: redactOrder(req, detail!) };
  });

  app.post('/:id/cancel', { preHandler: perm('pos', 'delete') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ reason: z.string().trim().min(3).max(300), refundMode: z.enum(['ORIGINAL', 'CASH', 'WALLET']).default('ORIGINAL') }), req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const before = await db.order.findFirst({ where: { id } });
    if (!before) throw notFound('Order');
    if (num(before.paidAmount) > 0 && !hasCap(ctx.perms, 'cancelPaidOrders')) {
      await audit(db, req, 'order.cancel_blocked', 'order', id, null, { orderNo: before.orderNo, paid: num(before.paidAmount) }, 'Attempt to cancel a paid invoice was blocked');
      throw forbidden('You are not allowed to cancel a paid invoice');
    }
    const r = await db.$transaction((tx) => cancelOrder(tx, ctx, id, body.reason, body.refundMode), { timeout: 20000 });
    await audit(
      db,
      req,
      r.deleted ? 'order.draft_discarded' : 'order.cancelled',
      'order',
      id,
      { orderNo: before.orderNo, status: before.status, total: num(before.total), paid: num(before.paidAmount) },
      { status: 'CANCELLED', refunded: r.refunded, refundMode: body.refundMode },
      body.reason,
    );
    if (r.refunded > 0) {
      await audit(db, req, 'order.refund', 'order', id, null, { orderNo: before.orderNo, amount: r.refunded, mode: body.refundMode }, body.reason);
    }
    if (r.deleted) return { ok: true };
    const detail = await loadOrderDetail(db, id);
    return { order: redactOrder(req, detail!) };
  });

  /** The shop has the clothes of an app order: number it, tag it, charge the wallet if chosen. */
  app.post('/:id/receive-app', { preHandler: perm('pos', 'create') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const r = await db.$transaction((tx) => receiveAppOrder(tx, ctx, id), { timeout: 20000 });
    await audit(db, req, 'order.app_received', 'order', id, null, { orderNo: r.order.orderNo, charged: r.charged });
    return { charged: r.charged, order: redactOrder(req, (await loadOrderDetail(db, id))!) };
  });

  /** Driver steps: on the way to collect, out for delivery (or back). */
  app.post('/:id/handover', { preHandler: anyPerm(['tracking', 'edit'], ['delivery', 'create']) }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ to: z.enum(['PICKUP_EN_ROUTE', 'AWAITING_PICKUP', 'OUT_FOR_DELIVERY', 'READY']) }), req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    await db.$transaction((tx) => setHandoverStatus(tx, ctx, id, body.to));
    return { order: redactOrder(req, (await loadOrderDetail(db, id))!) };
  });

  app.post('/:id/advance', { preHandler: perm('tracking', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ pieceNos: z.array(z.number().int().min(1)).max(500).nullish() }), req.body ?? {});
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const r = await db.$transaction((tx) => advanceOrder(tx, ctx, id, body.pieceNos));
    return { from: r.from, to: r.to, moved: r.moved.length, order: redactOrder(req, (await loadOrderDetail(db, id))!) };
  });

  app.post('/:id/status', { preHandler: perm('tracking', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(
      z.object({ status: z.enum(PIECE_STATUSES), pieceNos: z.array(z.number().int().min(1)).max(500).nullish() }),
      req.body,
    );
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    await db.$transaction((tx) => setOrderStatus(tx, ctx, id, body.status, body.pieceNos));
    return { order: redactOrder(req, (await loadOrderDetail(db, id))!) };
  });

  app.post('/:id/hold', { preHandler: perm('tracking', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ onHold: z.boolean(), reason: zOptStr(300) }), req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    await db.$transaction((tx) => setHold(tx, ctx, id, body.onHold, body.reason));
    return { order: redactOrder(req, (await loadOrderDetail(db, id))!) };
  });

  app.post('/:id/deliver', { preHandler: perm('delivery', 'create') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(
      z.object({ pieceNos: z.array(z.number().int().min(1)).max(500).nullish(), payments: z.array(paymentSchema).max(6).default([]) }),
      req.body ?? {},
    );
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const r = await db.$transaction((tx) => deliverOrder(tx, ctx, id, body.pieceNos, body.payments), { timeout: 20000 });
    return { delivered: r.delivered, remaining: r.remaining, order: redactOrder(req, (await loadOrderDetail(db, id))!) };
  });

  /** Receipt and tag print data (prices removed for users who may not see them). */
  app.get('/:id/print', { preHandler: viewAny }, async (req) => {
    const a = requireTenant(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const order = await buildPrintOrder(app, app.tdb(req), a.tenant.id, id);
    const priced = hasCap(a.perms, 'viewPrices');
    if (!hasCap(a.perms, 'viewCustomerPhone') && order.customer) order.customer.mobile = null;
    return {
      shop: {
        name: a.tenant.name,
        address: a.tenant.address,
        phone: a.tenant.phone,
        vatNumber: a.tenant.vatNumber,
        crNumber: a.tenant.crNumber,
        logoUrl: a.tenant.logoFileId ? `/api/files/${a.tenant.logoFileId}` : null,
      },
      receipt: a.settings.receipt,
      tag: a.settings.tag,
      // Without price access only what the item tags need is returned.
      order: priced
        ? order
        : {
            ...order,
            items: [],
            payments: [],
            subtotal: 0,
            discountTotal: 0,
            expressSurcharge: 0,
            vatAmount: 0,
            netAmount: 0,
            total: 0,
            paidAmount: 0,
            balanceDue: 0,
            walletBalance: null,
            qrLink: null,
          },
      canPrintReceipt: priced && can(a.perms, 'pos', 'view'),
    };
  });

  /** WhatsApp click-to-chat link with a prefilled template (order ready / receipt). */
  app.get('/:id/whatsapp', { preHandler: viewAny }, async (req) => {
    const a = requireTenant(req);
    if (!hasCap(a.perms, 'viewCustomerPhone')) throw forbidden();
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { type } = parse(z.object({ type: z.enum(['ready', 'receipt']) }), req.query);
    const o = await app.tdb(req).order.findFirst({ where: { id }, include: { customer: true } });
    if (!o || !o.customer) throw new AppError(400, 'NO_CUSTOMER', 'This order has no customer phone');
    const link = `${app.config.publicUrl}/api/documents/public/receipt/${receiptToken(app.config.appSecret, a.tenant.id, o.id)}.pdf`;
    const values = {
      customer: o.customer.name,
      orderNo: o.orderNo,
      shop: a.tenant.name,
      total: formatBhd(num(o.total)),
      due: formatBhd(num(o.balanceDue)),
      expected: fmtDateTime(o.expectedAt),
      link,
    };
    const tpl = type === 'ready' ? a.settings.whatsapp.orderReady : a.settings.whatsapp.receiptShare;
    const text = fillTemplate(tpl, values);
    await app.tdb(req).orderEvent.create({
      data: { tenantId: a.tenant.id, orderId: o.id, type: 'WHATSAPP', note: type, userId: a.user.id, userName: a.user.name },
    });
    return { url: whatsappLink(o.customer.mobile, text), text, link };
  });

}

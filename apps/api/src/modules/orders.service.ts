import type { Order, OrderPiece, PieceStatus, Prisma } from '@prisma/client';
import {
  PIECE_RANK,
  calcOrder,
  expectedReadyAt,
  fromFils,
  hasCap,
  nextPieceStatus,
  orderStatusFromPieces,
  splitWalletUse,
  stepsFor,
  subBhd,
  toFils,
  vatShare,
  type DiscountType,
  type MoneyInMethod,
} from '@laundry/shared';
import { currentBusinessDate } from '../lib/business-date';
import { AppError, forbidden, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { nextOrderNo, nextReceiptNo, type Ctx } from '../lib/service-context';
import type { TenantDb, TenantTx } from '../lib/tenant-db';
import { applyWalletDelta, lockCustomer } from './wallet.service';

// ───────────────────────────── Input types ─────────────────────────────

export interface OrderLineInput {
  itemTypeId: string;
  serviceTypeId: string;
  quantity: number;
  area?: number | null;
  unitPrice?: number | null; // override (requires capability)
  discountType?: DiscountType | null;
  discountValue?: number | null;
  color?: string | null;
  brand?: string | null;
  notes?: string | null;
  damage?: string[];
  damageNotes?: string | null;
  damagePhotoIds?: string[];
  customerPackageId?: string | null;
}

export interface PaymentInput {
  method: MoneyInMethod | 'WALLET';
  amount: number;
  reference?: string | null;
}

export interface OrderInput {
  customerId?: string | null;
  express: boolean;
  items: OrderLineInput[];
  orderDiscountType?: DiscountType | null;
  orderDiscountValue?: number | null;
  notes?: string | null;
  expectedAt?: Date | null;
}

type Q = TenantTx;

// ───────────────────────────── Pricing ─────────────────────────────

interface PricedLine {
  input: OrderLineInput;
  itemName: string;
  serviceName: string;
  unit: 'PIECE' | 'SQM';
  requiresProcessing: boolean;
  requiresIroning: boolean;
  unitPrice: number;
  listPrice: number;
  priceOverridden: boolean;
  turnaround: number;
  gross: number;
  discount: number;
  net: number;
  coveredByPackage: boolean;
}

export interface PricedOrder {
  lines: PricedLine[];
  totals: ReturnType<typeof calcOrder>;
  expectedAt: Date;
  pieceCount: number;
}

/** Look up prices, validate lines and compute totals. No writes. */
export async function priceOrder(db: Q | TenantDb, ctx: Ctx, input: OrderInput): Promise<PricedOrder> {
  if (!input.items.length) throw new AppError(400, 'EMPTY_ORDER', 'Add at least one item');
  const itemIds = [...new Set(input.items.map((i) => i.itemTypeId))];
  const serviceIds = [...new Set(input.items.map((i) => i.serviceTypeId))];
  const [items, services, prices] = await Promise.all([
    db.itemType.findMany({ where: { id: { in: itemIds } } }),
    db.serviceType.findMany({ where: { id: { in: serviceIds } } }),
    db.priceListEntry.findMany({ where: { itemTypeId: { in: itemIds }, serviceTypeId: { in: serviceIds } } }),
  ]);
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const priceMap = new Map(prices.map((p) => [`${p.itemTypeId}:${p.serviceTypeId}`, p]));

  const canOverride = hasCap(ctx.perms, 'overridePrice');
  const lines: Omit<PricedLine, 'gross' | 'discount' | 'net'>[] = input.items.map((l) => {
    const item = itemMap.get(l.itemTypeId);
    const service = serviceMap.get(l.serviceTypeId);
    if (!item) throw new AppError(400, 'BAD_ITEM', 'Unknown item type');
    if (!service) throw new AppError(400, 'BAD_SERVICE', 'Unknown service type');
    const entry = priceMap.get(`${l.itemTypeId}:${l.serviceTypeId}`);
    if (!entry || !entry.isActive) {
      throw new AppError(400, 'NO_PRICE', `${item.name} has no price for ${service.name}`);
    }
    if (item.unit === 'SQM' && !(Number(l.area) > 0)) {
      throw new AppError(400, 'AREA_REQUIRED', `Enter the size in m² for ${item.name}`);
    }
    const listPrice = input.express && entry.expressPrice !== null ? num(entry.expressPrice) : num(entry.price);
    let unitPrice = listPrice;
    let priceOverridden = false;
    if (l.unitPrice !== null && l.unitPrice !== undefined && toFils(l.unitPrice) !== toFils(listPrice)) {
      if (!canOverride) throw forbidden('You are not allowed to change prices');
      unitPrice = fromFils(toFils(l.unitPrice));
      priceOverridden = true;
    }
    return {
      input: l,
      itemName: item.name,
      serviceName: service.name,
      unit: item.unit,
      requiresProcessing: service.requiresProcessing,
      requiresIroning: service.requiresIroning,
      unitPrice,
      listPrice,
      priceOverridden,
      turnaround: input.express ? service.expressTurnaroundHours : service.turnaroundHours,
      coveredByPackage: !!l.customerPackageId,
    };
  });

  const s = ctx.settings;
  const totals = calcOrder({
    lines: lines.map((l) => ({
      unitPrice: l.unitPrice,
      unit: l.unit,
      quantity: l.input.quantity,
      area: l.input.area,
      discountType: l.input.discountType,
      discountValue: l.input.discountValue,
      coveredByPackage: l.coveredByPackage,
    })),
    express: input.express,
    expressSurchargeType: s.expressSurchargeType,
    expressSurchargeValue: s.expressSurchargeValue,
    orderDiscountType: input.orderDiscountType,
    orderDiscountValue: input.orderDiscountValue,
    vatRate: s.vatRate,
    pricesIncludeVat: s.pricesIncludeVat,
  });

  if (totals.discountTotal > 0 && totals.discountPercent > ctx.perms.maxDiscountPercent + 0.001) {
    throw new AppError(
      403,
      'DISCOUNT_LIMIT',
      `Discount of ${totals.discountPercent.toFixed(1)}% is above your limit of ${ctx.perms.maxDiscountPercent}%`,
    );
  }

  const maxHours = Math.max(...lines.map((l) => l.turnaround));
  const expectedAt = input.expectedAt ?? expectedReadyAt(new Date(), maxHours, ctx.workingHours);
  const pieceCount = lines.reduce((n, l) => n + l.input.quantity, 0);

  return {
    lines: lines.map((l, i) => ({ ...l, ...totals.lines[i], coveredByPackage: l.coveredByPackage })),
    totals,
    expectedAt,
    pieceCount,
  };
}

function orderTotalsData(p: PricedOrder, input: OrderInput, ctx: Ctx) {
  const t = p.totals;
  return {
    express: input.express,
    expectedAt: p.expectedAt,
    subtotal: t.subtotal,
    lineDiscountTotal: t.lineDiscountTotal,
    expressSurcharge: t.expressSurcharge,
    orderDiscountType: input.orderDiscountType ?? null,
    orderDiscountValue: input.orderDiscountValue ?? 0,
    orderDiscount: t.orderDiscount,
    discountTotal: t.discountTotal,
    netAmount: t.netAmount,
    vatRate: ctx.settings.vatRate,
    vatAmount: t.vatAmount,
    total: t.total,
    pieceCount: p.pieceCount,
    notes: input.notes ?? null,
  };
}

function itemRows(p: PricedOrder, ctx: Ctx) {
  return p.lines.map((l, i) => ({
    tenantId: ctx.tenantId,
    lineNo: i + 1,
    itemTypeId: l.input.itemTypeId,
    serviceTypeId: l.input.serviceTypeId,
    itemName: l.itemName,
    serviceName: l.serviceName,
    unit: l.unit,
    requiresProcessing: l.requiresProcessing,
    requiresIroning: l.requiresIroning,
    quantity: l.input.quantity,
    area: l.unit === 'SQM' ? (l.input.area ?? null) : null,
    unitPrice: l.unitPrice,
    priceOverridden: l.priceOverridden,
    discountType: l.input.discountType ?? null,
    discountValue: l.input.discountValue ?? 0,
    discountAmount: l.discount,
    grossAmount: l.gross,
    lineTotal: l.net,
    color: l.input.color ?? null,
    brand: l.input.brand ?? null,
    notes: l.input.notes ?? null,
    damage: l.input.damage ?? [],
    damageNotes: l.input.damageNotes ?? null,
    damagePhotoIds: l.input.damagePhotoIds ?? [],
    customerPackageId: l.input.customerPackageId ?? null,
  }));
}

// ───────────────────────────── Packages ─────────────────────────────

/** Consume item-package pieces for covered lines and recognise their revenue. */
async function redeemPackages(tx: Q, ctx: Ctx, order: Order, p: PricedOrder, businessDate: string) {
  const byPkg = new Map<string, { qty: number; line: PricedLine }>();
  for (const l of p.lines) {
    if (!l.input.customerPackageId) continue;
    const cur = byPkg.get(l.input.customerPackageId);
    byPkg.set(l.input.customerPackageId, { qty: (cur?.qty ?? 0) + l.input.quantity, line: l });
  }
  for (const [pkgId, { qty, line }] of byPkg) {
    const pkg = await tx.customerPackage.findFirst({ where: { id: pkgId } });
    if (!pkg || pkg.customerId !== order.customerId) throw new AppError(400, 'BAD_PACKAGE', 'Package not found for this customer');
    if (pkg.kind !== 'ITEMS' || pkg.status !== 'ACTIVE') throw new AppError(400, 'BAD_PACKAGE', `Package "${pkg.name}" is not active`);
    if (pkg.expiresAt && pkg.expiresAt < new Date()) throw new AppError(400, 'PACKAGE_EXPIRED', `Package "${pkg.name}" has expired`);
    if (pkg.itemTypeId && pkg.itemTypeId !== line.input.itemTypeId) throw new AppError(400, 'BAD_PACKAGE', `Package "${pkg.name}" does not cover ${line.itemName}`);
    if (pkg.serviceTypeId && pkg.serviceTypeId !== line.input.serviceTypeId) {
      throw new AppError(400, 'BAD_PACKAGE', `Package "${pkg.name}" does not cover ${line.serviceName}`);
    }
    for (const l of p.lines) {
      if (l.input.customerPackageId === pkgId && (l.input.itemTypeId !== line.input.itemTypeId || l.input.serviceTypeId !== line.input.serviceTypeId)) {
        throw new AppError(400, 'BAD_PACKAGE', `Package "${pkg.name}" covers one item and service only`);
      }
    }
    const updated = await tx.customerPackage.updateMany({
      where: { id: pkgId, remainingItems: { gte: qty } },
      data: { remainingItems: { decrement: qty } },
    });
    if (updated.count !== 1) throw new AppError(400, 'PACKAGE_EMPTY', `Package "${pkg.name}" has only ${pkg.remainingItems} items left`);
    if (pkg.remainingItems - qty === 0) await tx.customerPackage.update({ where: { id: pkgId }, data: { status: 'EXHAUSTED' } });

    // Revenue for package pieces is recognised when they are used.
    const revenue = fromFils(Math.round((toFils(num(pkg.pricePaid)) * qty) / Math.max(1, pkg.totalItems)));
    const rate = ctx.settings.vatRate;
    await tx.payment.create({
      data: {
        tenantId: ctx.tenantId,
        kind: 'PACKAGE_REDEMPTION',
        method: 'PACKAGE',
        amount: 0,
        orderId: order.id,
        customerId: order.customerId,
        revenueAmount: revenue,
        vatPortion: fromFils(Math.round((toFils(revenue) * rate) / (100 + rate))),
        businessDate,
        note: `${qty} × ${pkg.name}`,
        reference: pkgId,
        createdById: ctx.userId,
        createdByName: ctx.userName,
      },
    });
  }
}

/** Give back package pieces when an order is edited or cancelled. */
async function restorePackages(tx: Q, ctx: Ctx, orderId: string, businessDate: string) {
  const redemptions = await tx.payment.findMany({ where: { orderId, kind: 'PACKAGE_REDEMPTION' } });
  const net = new Map<string, number>();
  for (const r of redemptions) {
    if (!r.reference) continue;
    net.set(r.reference, (net.get(r.reference) ?? 0) + num(r.revenueAmount));
  }
  const items = await tx.orderItem.findMany({ where: { orderId, customerPackageId: { not: null } } });
  const qtyByPkg = new Map<string, number>();
  for (const it of items) qtyByPkg.set(it.customerPackageId!, (qtyByPkg.get(it.customerPackageId!) ?? 0) + it.quantity);
  for (const [pkgId, qty] of qtyByPkg) {
    const revenue = net.get(pkgId) ?? 0;
    if (revenue <= 0 && !redemptions.some((r) => r.reference === pkgId)) continue;
    const pkg = await tx.customerPackage.findFirst({ where: { id: pkgId } });
    if (!pkg) continue;
    await tx.customerPackage.update({
      where: { id: pkgId },
      data: { remainingItems: { increment: qty }, status: pkg.status === 'EXHAUSTED' ? 'ACTIVE' : pkg.status },
    });
    if (revenue > 0) {
      const rate = ctx.settings.vatRate;
      await tx.payment.create({
        data: {
          tenantId: ctx.tenantId,
          kind: 'PACKAGE_REDEMPTION',
          method: 'PACKAGE',
          amount: 0,
          orderId,
          customerId: pkg.customerId,
          revenueAmount: -revenue,
          vatPortion: -fromFils(Math.round((toFils(revenue) * rate) / (100 + rate))),
          businessDate,
          note: `Returned ${qty} × ${pkg.name}`,
          reference: pkgId,
          createdById: ctx.userId,
          createdByName: ctx.userName,
        },
      });
    }
  }
}

// ───────────────────────────── Payments ─────────────────────────────

/** Recompute paid / balance due / payment state of an order from its payments. */
export async function refreshPaymentState(tx: Q, orderId: string) {
  const o = await tx.order.findFirstOrThrow({ where: { id: orderId } });
  const agg = await tx.payment.aggregate({ where: { orderId, kind: { in: ['ORDER', 'REFUND'] } }, _sum: { amount: true } });
  const paid = num(agg._sum.amount);
  const total = num(o.total);
  const due = o.status === 'CANCELLED' ? 0 : Math.max(0, subBhd(total, paid));
  const state = o.status === 'CANCELLED' ? (paid > 0 ? 'PARTIAL' : 'UNPAID') : toFils(paid) >= toFils(total) ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
  return tx.order.update({ where: { id: orderId }, data: { paidAmount: paid, balanceDue: due, paymentState: state } });
}

/** Apply payments to an order (cash, card, BenefitPay, bank transfer or prepaid balance). */
export async function applyOrderPayments(
  tx: Q,
  ctx: Ctx,
  order: Order,
  payments: PaymentInput[],
  opts: { businessDate?: string; batchId?: string; receiptNo?: string; note?: string } = {},
) {
  const list = payments.filter((p) => toFils(p.amount) > 0);
  if (!list.length) return [];
  const due = toFils(num(order.total)) - toFils(num(order.paidAmount));
  const sum = list.reduce((s, p) => s + toFils(p.amount), 0);
  if (sum > due) throw new AppError(400, 'OVERPAYMENT', 'Payment is more than the balance due');
  const businessDate = opts.businessDate ?? (await currentBusinessDate(tx));
  const created = [];
  for (const p of list) {
    const amount = fromFils(toFils(p.amount));
    let paidPortion = 0;
    let bonusPortion = 0;
    let revenue = amount;
    if (p.method === 'WALLET') {
      if (!order.customerId) throw new AppError(400, 'NO_CUSTOMER', 'Prepaid balance needs a customer');
      const c = await lockCustomer(tx, ctx, order.customerId);
      const split = splitWalletUse(amount, num(c.walletPaid), num(c.walletBonus));
      if (toFils(split.paid + split.bonus) < toFils(amount)) {
        throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Not enough prepaid balance');
      }
      paidPortion = split.paid;
      bonusPortion = split.bonus;
      // Bonus credit is not revenue: only the customer-paid part of the balance is recognised.
      revenue = split.paid;
    }
    const payment = await tx.payment.create({
      data: {
        tenantId: ctx.tenantId,
        kind: 'ORDER',
        method: p.method,
        amount,
        orderId: order.id,
        customerId: order.customerId,
        walletPaidPortion: paidPortion,
        walletBonusPortion: bonusPortion,
        revenueAmount: revenue,
        vatPortion: vatShare(revenue, num(order.vatAmount), num(order.total)),
        businessDate,
        batchId: opts.batchId ?? null,
        receiptNo: opts.receiptNo ?? null,
        reference: p.reference ?? null,
        note: opts.note ?? null,
        createdById: ctx.userId,
        createdByName: ctx.userName,
      },
    });
    if (p.method === 'WALLET') {
      await applyWalletDelta(tx, ctx, order.customerId!, {
        paidDelta: -paidPortion,
        bonusDelta: -bonusPortion,
        type: 'ORDER_PAYMENT',
        paymentId: payment.id,
        orderId: order.id,
        reason: `Order #${order.orderNo}`,
      });
    }
    created.push(payment);
  }
  await tx.orderEvent.create({
    data: {
      tenantId: ctx.tenantId,
      orderId: order.id,
      type: 'PAYMENT',
      note: list.map((p) => `${p.method} ${fromFils(toFils(p.amount)).toFixed(3)}`).join(', '),
      userId: ctx.userId,
      userName: ctx.userName,
    },
  });
  return created;
}

async function assertCredit(tx: Q, ctx: Ctx, customerId: string | null | undefined, additional: number, excludeOrderId?: string) {
  if (!customerId) throw new AppError(400, 'NO_CUSTOMER', 'Credit orders need a customer');
  const c = await tx.customer.findFirst({ where: { id: customerId } });
  if (!c) throw notFound('Customer');
  if (!c.creditEnabled) throw new AppError(400, 'NO_CREDIT', 'This customer does not have a credit account');
  const limit = num(c.creditLimit);
  if (limit > 0) {
    const agg = await tx.order.aggregate({
      where: { customerId, onAccount: true, status: { not: 'CANCELLED' }, balanceDue: { gt: 0 }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
      _sum: { balanceDue: true },
    });
    const outstanding = num(agg._sum.balanceDue);
    if (toFils(outstanding) + toFils(additional) > toFils(limit)) {
      throw new AppError(400, 'CREDIT_LIMIT', `Credit limit exceeded (outstanding ${outstanding.toFixed(3)} of ${limit.toFixed(3)})`);
    }
  }
}

// ───────────────────────────── Create / edit ─────────────────────────────

async function createPieces(tx: Q, ctx: Ctx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { lineNo: 'asc' } });
  let n = 0;
  const rows: Prisma.OrderPieceCreateManyInput[] = [];
  for (const it of items) {
    for (let q = 0; q < it.quantity; q++) {
      rows.push({ tenantId: ctx.tenantId, orderId, orderItemId: it.id, pieceNo: ++n, status: 'RECEIVED' });
    }
  }
  if (rows.length) await tx.orderPiece.createMany({ data: rows });
  return n;
}

export interface CreateOrderOptions {
  park?: boolean;
  draftId?: string | null;
  payments?: PaymentInput[];
  onAccount?: boolean;
}

/**
 * Create an order. Parked orders are saved as DRAFT without a number;
 * otherwise the order is received: it gets its number (= invoice number),
 * pieces/tags are created, packages redeemed and payments applied.
 */
export async function createOrder(tx: Q, ctx: Ctx, input: OrderInput, opts: CreateOrderOptions = {}) {
  const priced = await priceOrder(tx, ctx, input);
  if (input.customerId) {
    const c = await tx.customer.findFirst({ where: { id: input.customerId } });
    if (!c) throw notFound('Customer');
  }
  if (priced.lines.some((l) => l.coveredByPackage) && !input.customerId) {
    throw new AppError(400, 'NO_CUSTOMER', 'Packages need a customer');
  }

  let draft: Order | null = null;
  if (opts.draftId) {
    draft = await tx.order.findFirst({ where: { id: opts.draftId } });
    if (!draft || draft.status !== 'DRAFT') throw new AppError(400, 'NOT_DRAFT', 'Parked order not found');
    await tx.orderItem.deleteMany({ where: { orderId: draft.id } });
  }

  const data = orderTotalsData(priced, input, ctx);
  if (opts.park) {
    const order = draft
      ? await tx.order.update({ where: { id: draft.id }, data: { ...data, customerId: input.customerId ?? null } })
      : await tx.order.create({
          data: { ...data, tenantId: ctx.tenantId, status: 'DRAFT', customerId: input.customerId ?? null, createdById: ctx.userId, createdByName: ctx.userName },
        });
    await tx.orderItem.createMany({ data: itemRows(priced, ctx).map((r) => ({ ...r, orderId: order.id })) });
    return order;
  }

  const orderNo = await nextOrderNo(tx, ctx.tenantId);
  const businessDate = await currentBusinessDate(tx);
  const now = new Date();
  const base = {
    ...data,
    orderNo,
    status: 'RECEIVED' as const,
    customerId: input.customerId ?? null,
    onAccount: !!opts.onAccount,
    businessDate,
    receivedAt: now,
    balanceDue: data.total,
    paymentState: (toFils(data.total) === 0 ? 'PAID' : 'UNPAID') as 'PAID' | 'UNPAID',
  };
  const order = draft
    ? await tx.order.update({ where: { id: draft.id }, data: { ...base, createdAt: now, createdById: ctx.userId, createdByName: ctx.userName } })
    : await tx.order.create({ data: { ...base, tenantId: ctx.tenantId, createdById: ctx.userId, createdByName: ctx.userName } });
  await tx.orderItem.createMany({ data: itemRows(priced, ctx).map((r) => ({ ...r, orderId: order.id })) });
  await createPieces(tx, ctx, order.id);
  await redeemPackages(tx, ctx, order, priced, businessDate);
  await tx.orderEvent.create({
    data: { tenantId: ctx.tenantId, orderId: order.id, type: 'CREATED', toStatus: 'RECEIVED', pieceCount: priced.pieceCount, userId: ctx.userId, userName: ctx.userName },
  });

  if (opts.payments?.length) await applyOrderPayments(tx, ctx, order, opts.payments, { businessDate });
  const refreshed = await refreshPaymentState(tx, order.id);
  if (opts.onAccount && num(refreshed.balanceDue) > 0) {
    await assertCredit(tx, ctx, order.customerId, 0);
  }
  return refreshed;
}

/** Edit an order before processing starts (all pieces still RECEIVED). */
export async function updateOrder(tx: Q, ctx: Ctx, orderId: string, input: OrderInput) {
  const order = await tx.order.findFirst({ where: { id: orderId }, include: { pieces: true } });
  if (!order) throw notFound('Order');
  if (order.status === 'DRAFT') return createOrder(tx, ctx, input, { park: true, draftId: orderId });
  if (order.status !== 'RECEIVED' || order.pieces.some((p) => p.status !== 'RECEIVED')) {
    throw new AppError(409, 'IN_PROCESS', 'The order is already in process and can no longer be edited');
  }
  if (input.customerId !== order.customerId && order.paidAmount && num(order.paidAmount) > 0) {
    throw new AppError(409, 'HAS_PAYMENTS', 'The customer cannot be changed after payment');
  }
  const priced = await priceOrder(tx, ctx, input);
  if (toFils(priced.totals.total) < toFils(num(order.paidAmount))) {
    throw new AppError(409, 'BELOW_PAID', 'The new total is less than what was already paid. Cancel and refund instead.');
  }
  const businessDate = await currentBusinessDate(tx);
  await restorePackages(tx, ctx, orderId, businessDate);
  await tx.orderPiece.deleteMany({ where: { orderId } });
  await tx.orderItem.deleteMany({ where: { orderId } });
  const data = orderTotalsData(priced, input, ctx);
  const updated = await tx.order.update({ where: { id: orderId }, data: { ...data, customerId: input.customerId ?? null } });
  await tx.orderItem.createMany({ data: itemRows(priced, ctx).map((r) => ({ ...r, orderId })) });
  await createPieces(tx, ctx, orderId);
  await redeemPackages(tx, ctx, updated, priced, businessDate);
  if (updated.onAccount) await assertCredit(tx, ctx, updated.customerId, 0, orderId);
  await tx.orderEvent.create({
    data: {
      tenantId: ctx.tenantId,
      orderId,
      type: 'EDITED',
      note: `Total ${num(order.total).toFixed(3)} → ${priced.totals.total.toFixed(3)}`,
      pieceCount: priced.pieceCount,
      userId: ctx.userId,
      userName: ctx.userName,
    },
  });
  return { before: order, after: await refreshPaymentState(tx, orderId), priced };
}

// ───────────────────────────── Cancel / refund ─────────────────────────────

export type RefundMode = 'ORIGINAL' | 'CASH' | 'WALLET';

/** Cancel an order, refunding every payment. Paid orders need the cancelPaidOrders capability. */
export async function cancelOrder(tx: Q, ctx: Ctx, orderId: string, reason: string, refundMode: RefundMode = 'ORIGINAL') {
  const order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order) throw notFound('Order');
  if (order.status === 'CANCELLED') throw new AppError(409, 'ALREADY_CANCELLED', 'Order is already cancelled');
  if (order.status === 'DELIVERED') throw new AppError(409, 'DELIVERED', 'A delivered order cannot be cancelled');
  if (order.status === 'DRAFT') {
    await tx.order.delete({ where: { id: orderId } });
    return { order, refunded: 0, deleted: true };
  }
  const payments = await tx.payment.findMany({ where: { orderId, kind: 'ORDER' } });
  const refunds = await tx.payment.findMany({ where: { orderId, kind: 'REFUND' } });
  const paidNet = payments.reduce((s, p) => s + toFils(num(p.amount)), 0) + refunds.reduce((s, p) => s + toFils(num(p.amount)), 0);
  if (paidNet > 0 && !hasCap(ctx.perms, 'cancelPaidOrders')) {
    throw forbidden('You are not allowed to cancel a paid invoice');
  }
  const businessDate = await currentBusinessDate(tx);
  const receiptNo = paidNet > 0 ? await nextReceiptNo(tx, ctx.tenantId) : null;
  let refunded = 0;
  for (const p of payments) {
    const amount = num(p.amount);
    if (amount <= 0) continue;
    const toWallet = p.method === 'WALLET' || refundMode === 'WALLET';
    if (toWallet && !order.customerId) throw new AppError(400, 'NO_CUSTOMER', 'Refund to balance needs a customer');
    const method = p.method === 'WALLET' ? 'WALLET' : refundMode === 'WALLET' ? 'WALLET' : refundMode === 'CASH' ? 'CASH' : p.method;
    const refund = await tx.payment.create({
      data: {
        tenantId: ctx.tenantId,
        kind: 'REFUND',
        method,
        amount: -amount,
        orderId,
        customerId: order.customerId,
        walletPaidPortion: p.method === 'WALLET' ? -num(p.walletPaidPortion) : 0,
        walletBonusPortion: p.method === 'WALLET' ? -num(p.walletBonusPortion) : 0,
        revenueAmount: -num(p.revenueAmount),
        vatPortion: -num(p.vatPortion),
        businessDate,
        receiptNo,
        reference: p.id,
        note: reason,
        createdById: ctx.userId,
        createdByName: ctx.userName,
      },
    });
    if (toWallet) {
      // Wallet payments go back as they came (paid + bonus); other payments become paid credit.
      const paidBack = p.method === 'WALLET' ? num(p.walletPaidPortion) : amount;
      const bonusBack = p.method === 'WALLET' ? num(p.walletBonusPortion) : 0;
      await applyWalletDelta(tx, ctx, order.customerId!, {
        paidDelta: paidBack,
        bonusDelta: bonusBack,
        type: 'ORDER_REFUND',
        paymentId: refund.id,
        orderId,
        reason: `Refund for cancelled order #${order.orderNo}`,
      });
    }
    refunded += amount;
  }
  await restorePackages(tx, ctx, orderId, businessDate);
  await tx.order.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason, onHold: false },
  });
  await tx.orderEvent.create({
    data: { tenantId: ctx.tenantId, orderId, type: 'CANCELLED', fromStatus: order.status, toStatus: 'CANCELLED', note: reason, userId: ctx.userId, userName: ctx.userName },
  });
  await refreshPaymentState(tx, orderId);
  return { order, refunded: fromFils(toFils(refunded)), deleted: false };
}

// ───────────────────────────── Status flow ─────────────────────────────

type PieceWithItem = OrderPiece & { orderItem: { requiresProcessing: boolean; requiresIroning: boolean } };

async function syncOrderStatus(tx: Q, ctx: Ctx, orderId: string) {
  const order = await tx.order.findFirstOrThrow({ where: { id: orderId }, include: { pieces: true } });
  const status = orderStatusFromPieces(order.pieces);
  const delivered = order.pieces.filter((p) => p.status === 'DELIVERED').length;
  const data: Prisma.OrderUpdateInput = {
    status,
    partiallyDelivered: delivered > 0 && delivered < order.pieces.length,
  };
  if (status === 'READY' && !order.readyAt) data.readyAt = new Date();
  if (status !== 'READY' && status !== 'DELIVERED') data.readyAt = null;
  if (status === 'DELIVERED' && !order.deliveredAt) {
    data.deliveredAt = new Date();
    data.deliveredById = ctx.userId;
    data.deliveredByName = ctx.userName;
  }
  return tx.order.update({ where: { id: orderId }, data });
}

function assertWorkable(order: Order) {
  if (order.status === 'DRAFT') throw new AppError(409, 'DRAFT', 'This order is parked and has not been received yet');
  if (order.status === 'CANCELLED') throw new AppError(409, 'CANCELLED', 'This order is cancelled');
  if (order.status === 'DELIVERED') throw new AppError(409, 'DELIVERED', 'This order has already been delivered');
  if (order.onHold) throw new AppError(409, 'ON_HOLD', `Order is on hold${order.holdReason ? `: ${order.holdReason}` : ''}`);
}

/**
 * Move pieces to their next workflow step. Without pieceNos, the whole order
 * moves: every piece at the order's current (least advanced) status steps forward.
 */
export async function advanceOrder(tx: Q, ctx: Ctx, orderId: string, pieceNos?: number[] | null) {
  const order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order) throw notFound('Order');
  assertWorkable(order);
  const pieces = (await tx.orderPiece.findMany({
    where: { orderId },
    include: { orderItem: { select: { requiresProcessing: true, requiresIroning: true } } },
    orderBy: { pieceNo: 'asc' },
  })) as PieceWithItem[];
  const current = orderStatusFromPieces(pieces);
  const targets = pieceNos?.length
    ? pieces.filter((p) => pieceNos.includes(p.pieceNo))
    : pieces.filter((p) => p.status === current);
  if (pieceNos?.length && targets.length !== new Set(pieceNos).size) throw new AppError(404, 'PIECE_NOT_FOUND', 'Tag not found on this order');

  const moved: { pieceNo: number; from: PieceStatus; to: PieceStatus }[] = [];
  for (const p of targets) {
    const next = nextPieceStatus(p.status, p.orderItem);
    if (!next) continue;
    await tx.orderPiece.update({ where: { id: p.id }, data: { status: next } });
    moved.push({ pieceNo: p.pieceNo, from: p.status, to: next });
  }
  if (!moved.length) {
    throw new AppError(409, 'NOTHING_TO_ADVANCE', current === 'READY' ? 'Already ready for pickup' : 'Nothing to move');
  }
  await logStatusEvents(tx, ctx, orderId, moved);
  const updated = await syncOrderStatus(tx, ctx, orderId);
  return { order: updated, moved, from: current, to: updated.status };
}

/** Set pieces (or the whole order) to a given status — used by the board and manual corrections. */
export async function setOrderStatus(tx: Q, ctx: Ctx, orderId: string, target: PieceStatus, pieceNos?: number[] | null) {
  if (target === 'DELIVERED') throw new AppError(400, 'USE_DELIVERY', 'Use delivery to hand orders to the customer');
  const order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order) throw notFound('Order');
  assertWorkable(order);
  const pieces = (await tx.orderPiece.findMany({
    where: { orderId, status: { not: 'DELIVERED' } },
    include: { orderItem: { select: { requiresProcessing: true, requiresIroning: true } } },
  })) as PieceWithItem[];
  const selected = pieceNos?.length ? pieces.filter((p) => pieceNos.includes(p.pieceNo)) : pieces;
  const moved: { pieceNo: number; from: PieceStatus; to: PieceStatus }[] = [];
  for (const p of selected) {
    const steps = stepsFor(p.orderItem);
    const to = steps.includes(target) ? target : (steps.find((s) => PIECE_RANK[s] >= PIECE_RANK[target]) ?? 'READY');
    if (to === p.status) continue;
    await tx.orderPiece.update({ where: { id: p.id }, data: { status: to } });
    moved.push({ pieceNo: p.pieceNo, from: p.status, to });
  }
  if (moved.length) await logStatusEvents(tx, ctx, orderId, moved);
  const updated = await syncOrderStatus(tx, ctx, orderId);
  return { order: updated, moved };
}

async function logStatusEvents(tx: Q, ctx: Ctx, orderId: string, moved: { pieceNo: number; from: PieceStatus; to: PieceStatus }[]) {
  const groups = new Map<string, number[]>();
  for (const m of moved) {
    const k = `${m.from}>${m.to}`;
    groups.set(k, [...(groups.get(k) ?? []), m.pieceNo]);
  }
  for (const [k, nos] of groups) {
    const [from, to] = k.split('>');
    await tx.orderEvent.create({
      data: { tenantId: ctx.tenantId, orderId, type: 'STATUS', fromStatus: from, toStatus: to, pieceNos: nos, pieceCount: nos.length, userId: ctx.userId, userName: ctx.userName },
    });
  }
}

export async function setHold(tx: Q, ctx: Ctx, orderId: string, onHold: boolean, reason?: string | null) {
  const order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order) throw notFound('Order');
  if (['DRAFT', 'CANCELLED', 'DELIVERED'].includes(order.status)) throw new AppError(409, 'NOT_ACTIVE', 'Only active orders can be put on hold');
  const updated = await tx.order.update({ where: { id: orderId }, data: { onHold, holdReason: onHold ? (reason ?? null) : null } });
  await tx.orderEvent.create({
    data: { tenantId: ctx.tenantId, orderId, type: onHold ? 'HOLD' : 'RELEASE', note: reason ?? null, userId: ctx.userId, userName: ctx.userName },
  });
  return updated;
}

/**
 * Hand pieces to the customer. Payments collected at the counter are applied
 * first; the balance must be settled unless the order is on a credit account.
 */
export async function deliverOrder(tx: Q, ctx: Ctx, orderId: string, pieceNos: number[] | null | undefined, payments: PaymentInput[]) {
  let order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order) throw notFound('Order');
  if (order.status === 'DRAFT' || order.status === 'CANCELLED' || order.status === 'DELIVERED') assertWorkable(order);
  if (order.onHold) throw new AppError(409, 'ON_HOLD', `Order is on hold${order.holdReason ? `: ${order.holdReason}` : ''}`);
  if (payments.length) {
    await applyOrderPayments(tx, ctx, order, payments);
    order = await refreshPaymentState(tx, orderId);
  }
  if (num(order.balanceDue) > 0 && !order.onAccount && ctx.settings.requirePaymentBeforeDelivery) {
    throw new AppError(409, 'BALANCE_DUE', `Collect the balance due (BHD ${num(order.balanceDue).toFixed(3)}) before delivery`);
  }
  if (order.onAccount && num(order.balanceDue) > 0) await assertCredit(tx, ctx, order.customerId, 0, orderId);
  const pieces = await tx.orderPiece.findMany({ where: { orderId, status: { not: 'DELIVERED' } }, orderBy: { pieceNo: 'asc' } });
  const selected = pieceNos?.length ? pieces.filter((p) => pieceNos.includes(p.pieceNo)) : pieces;
  if (!selected.length) throw new AppError(400, 'NO_PIECES', 'No pieces selected for delivery');
  const notReady = selected.filter((p) => p.status !== 'READY');
  if (notReady.length) {
    throw new AppError(409, 'NOT_READY', `Pieces not ready yet: ${notReady.map((p) => p.pieceNo).join(', ')}`);
  }
  const now = new Date();
  await tx.orderPiece.updateMany({
    where: { id: { in: selected.map((p) => p.id) } },
    data: { status: 'DELIVERED', deliveredAt: now, deliveredById: ctx.userId },
  });
  await tx.orderEvent.create({
    data: {
      tenantId: ctx.tenantId,
      orderId,
      type: 'DELIVERED',
      fromStatus: 'READY',
      toStatus: 'DELIVERED',
      pieceNos: selected.map((p) => p.pieceNo),
      pieceCount: selected.length,
      userId: ctx.userId,
      userName: ctx.userName,
    },
  });
  const updated = await syncOrderStatus(tx, ctx, orderId);
  return { order: updated, delivered: selected.length, remaining: pieces.length - selected.length };
}

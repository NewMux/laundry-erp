import crypto from 'node:crypto';
import type { AppUser, Customer, PrismaClient, Tenant } from '@prisma/client';
import {
  DEFAULT_WORKING_HOURS,
  driverFee,
  earliestDelivery,
  formatMobile,
  isHandoverOffered,
  parseSettings,
  slotState,
  toFils,
  usesDriver,
  type Handover,
  type TenantSettings,
  type WorkingHours,
} from '@laundry/shared';
import { scopedDb } from '../lib/context';
import { AppError } from '../lib/errors';
import { num } from '../lib/prisma';
import type { Ctx } from '../lib/service-context';
import { subscriptionInfo } from '../lib/subscription';
import type { TenantDb, TenantTx } from '../lib/tenant-db';
import { appIcon } from './customer-app.dto';
import { cancelOrder, createOrder, priceOrder, type OrderInput, type OrderLineInput, type PricedOrder } from './orders.service';

/** A customer acting in one shop through the app. */
export interface Member {
  tenant: Tenant;
  settings: TenantSettings;
  customer: Customer;
  db: TenantDb;
  ctx: Ctx;
}

const NO_PERMS = { modules: {}, caps: {}, maxDiscountPercent: 0 };

function appCtx(tenant: Tenant, settings: TenantSettings, user: AppUser, customer: Pick<Customer, 'name'>): Ctx {
  const wh = tenant.workingHours as unknown as WorkingHours;
  return {
    tenantId: tenant.id,
    userId: `app:${user.id}`,
    userName: `${customer.name || formatMobile(user.phone)} (app)`,
    settings,
    // Customers can never override prices or give discounts.
    perms: NO_PERMS as Ctx['perms'],
    workingHours: wh && typeof wh === 'object' && 'sun' in wh ? wh : DEFAULT_WORKING_HOURS,
    roleKey: null,
  };
}

/** A shop customers can use: app turned on, not suspended. */
function assertOpen(tenant: Tenant | null): asserts tenant is Tenant {
  if (!tenant) throw new AppError(404, 'not_found', 'No laundry with that code');
  const settings = parseSettings(tenant.settings);
  if (!settings.customerApp.enabled || subscriptionInfo(tenant).state === 'SUSPENDED') {
    throw new AppError(404, 'not_found', 'No laundry with that code');
  }
}

export async function tenantByCode(prisma: PrismaClient, code: string): Promise<Tenant> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tenant = clean ? await prisma.tenant.findUnique({ where: { customerCode: clean } }) : null;
  assertOpen(tenant);
  return tenant;
}

/** The signed-in customer's record at a shop they joined. */
export async function memberOf(prisma: PrismaClient, user: AppUser, tenantId: string): Promise<Member> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  assertOpen(tenant);
  const db = scopedDb(prisma, tenant.id);
  const customer = await db.customer.findFirst({ where: { appUserId: user.id } });
  if (!customer) throw new AppError(404, 'not_found', 'You have not joined this laundry');
  const settings = parseSettings(tenant.settings);
  return { tenant, settings, customer, db, ctx: appCtx(tenant, settings, user, customer) };
}

/** Writes are refused while the shop's subscription has lapsed (read-only, like the staff app). */
export function assertWritable(m: Member) {
  if (subscriptionInfo(m.tenant).readOnly) throw new AppError(403, 'laundry_unavailable', 'This laundry is not taking app orders right now');
}

/**
 * Link the app account to the shop's customer with the same mobile number,
 * creating the customer if the shop doesn't know them yet. Existing shop
 * customers keep their wallet, packages and history.
 */
export async function joinShop(prisma: PrismaClient, user: AppUser, tenant: Tenant): Promise<{ customer: Customer; isNew: boolean }> {
  const db = scopedDb(prisma, tenant.id);
  const existing = await db.customer.findFirst({ where: { mobile: user.phone } });
  if (existing) {
    const customer =
      existing.appUserId === user.id ? existing : await db.customer.update({ where: { id: existing.id }, data: { appUserId: user.id } });
    return { customer, isNew: false };
  }
  const customer = await db.customer.create({
    data: { tenantId: tenant.id, name: user.name || formatMobile(user.phone), mobile: user.phone, appUserId: user.id, notes: 'Joined through the customer app' },
  });
  return { customer, isNew: true };
}

// ───────────────────────────── Pricing ─────────────────────────────

export interface AppLine {
  garmentId: string;
  service: string;
  quantity: number;
  note?: string | null;
}

export interface QuoteInput {
  lines: AppLine[];
  express: boolean;
  handover: Handover;
}

/**
 * Turn app lines into order lines, putting the customer's item packages on the
 * pieces they cover (soonest-expiring first). A line only partly covered is
 * split in two, because a package covers whole order lines.
 */
async function toOrderLines(db: TenantDb | TenantTx, customerId: string, lines: AppLine[]): Promise<OrderLineInput[]> {
  const now = new Date();
  const packages = await db.customerPackage.findMany({
    where: { customerId, kind: 'ITEMS', status: 'ACTIVE', remainingItems: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });
  const left = new Map(packages.map((p) => [p.id, p.remainingItems]));
  const out: OrderLineInput[] = [];
  for (const l of lines) {
    let qty = l.quantity;
    const base = { itemTypeId: l.garmentId, serviceTypeId: l.service, notes: l.note?.trim() || null };
    for (const p of packages) {
      if (qty === 0) break;
      if ((p.itemTypeId && p.itemTypeId !== l.garmentId) || (p.serviceTypeId && p.serviceTypeId !== l.service)) continue;
      const use = Math.min(qty, left.get(p.id) ?? 0);
      if (use <= 0) continue;
      out.push({ ...base, quantity: use, customerPackageId: p.id });
      left.set(p.id, (left.get(p.id) ?? 0) - use);
      qty -= use;
    }
    if (qty > 0) out.push({ ...base, quantity: qty });
  }
  return out;
}

export interface Quote {
  input: OrderInput;
  priced: PricedOrder;
  fee: number;
  /** Slowest service on the order, for the earliest possible delivery. */
  turnaroundHours: number;
}

export async function quote(m: Member, q: QuoteInput, notes?: string | null): Promise<Quote> {
  const a = m.settings.customerApp;
  if (!isHandoverOffered(a, q.handover)) throw new AppError(400, 'invalid_order', 'This laundry does not offer that pickup or delivery option');
  const items = await toOrderLines(m.db, m.customer.id, q.lines);
  const base: OrderInput = { customerId: m.customer.id, express: q.express, items, notes: notes?.trim() || null };
  try {
    // The fee depends on the order's value, so price it once without, then with the fee.
    const before = await priceOrder(m.db, m.ctx, { ...base, serviceCharge: 0 });
    const fee = driverFee(a, q.handover, before.totals.netAmount);
    const input = { ...base, serviceCharge: fee };
    const priced = fee > 0 ? await priceOrder(m.db, m.ctx, input) : before;
    const turnaroundHours = Math.max(0, ...priced.lines.map((l) => l.turnaround));
    return { input, priced, fee, turnaroundHours };
  } catch (e) {
    if (e instanceof AppError && e.statusCode < 500) throw new AppError(400, 'invalid_order', e.message);
    throw e;
  }
}

/** The app's PricedOrder (fils), for the live total at checkout. */
export async function pricedDto(m: Member, q: Quote, handover: Handover) {
  const items = await m.db.itemType.findMany({ where: { id: { in: q.priced.lines.map((l) => l.input.itemTypeId) } }, select: { id: true, imageKey: true, nameAr: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const t = q.priced.totals;
  return {
    lines: q.priced.lines.map((l) => ({
      garmentId: l.input.itemTypeId,
      name: { en: l.itemName, ar: byId.get(l.input.itemTypeId)?.nameAr?.trim() || l.itemName },
      icon: appIcon(byId.get(l.input.itemTypeId)?.imageKey),
      service: l.input.serviceTypeId,
      quantity: l.input.quantity,
      unitPrice: toFils(l.unitPrice),
      coveredByPackage: l.coveredByPackage ? l.input.quantity : 0,
      packageUse: l.input.customerPackageId ? [{ packageId: l.input.customerPackageId, count: l.input.quantity }] : [],
      lineTotal: toFils(l.net),
      ...(l.input.notes ? { note: l.input.notes } : {}),
    })),
    totals: {
      subtotal: toFils(t.subtotal) - toFils(t.lineDiscountTotal),
      expressFee: toFils(t.expressSurcharge),
      driverFee: toFils(t.serviceCharge),
      discount: toFils(t.discountTotal),
      taxable: toFils(t.netAmount),
      vat: toFils(t.vatAmount),
      total: toFils(t.total),
    },
    vatBps: Math.round(m.settings.vatRate * 100),
    express: q.input.express,
    handover: { inbound: handover.inbound === 'PICKUP' ? 'pickup' : 'dropoff', outbound: handover.outbound === 'DELIVERY' ? 'delivery' : 'collect' },
  };
}

// ───────────────────────────── Placing an order ─────────────────────────────

export interface PlaceInput extends QuoteInput {
  addressId?: string | null;
  pickupSlot?: { date: string; slotId: string } | null;
  deliverySlot?: { date: string; slotId: string } | null;
  notes: string;
  paymentMethod: 'wallet' | 'card_counter' | 'cash_counter' | 'benefitpay';
  idempotencyKey: string;
  expectedTotal?: number | null;
}

const PAY_IN: Record<string, 'WALLET' | 'CARD' | 'CASH'> = { wallet: 'WALLET', card_counter: 'CARD', cash_counter: 'CASH' };
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => `A-${Array.from({ length: 6 }, () => REF_CHARS[crypto.randomInt(REF_CHARS.length)]).join('')}`;

/**
 * Save an app order. It is a pre-order (DRAFT, no invoice number) until the
 * shop has the clothes: dropped off at the counter or collected by the driver.
 * Nothing is charged now; a wallet payment is taken when it is received.
 */
export async function placeOrder(m: Member, input: PlaceInput) {
  assertWritable(m);
  const prior = await m.db.order.findFirst({ where: { appIdempotencyKey: input.idempotencyKey, customerId: m.customer.id }, select: { id: true } });
  if (prior) return prior.id;

  const a = m.settings.customerApp;
  const method = PAY_IN[input.paymentMethod];
  const allowed = { WALLET: a.payWallet, CARD: a.payCard, CASH: a.payCash };
  if (!method || !allowed[method]) throw new AppError(400, 'invalid_order', 'This laundry does not accept that payment method in the app');

  const q = await quote(m, input, input.notes);
  const now = new Date();
  const h = input.handover;

  let address: object | null = null;
  if (usesDriver(h)) {
    const found = input.addressId ? await m.db.customerAddress.findFirst({ where: { id: input.addressId, customerId: m.customer.id } }) : null;
    if (!found) throw new AppError(400, 'invalid_order', 'Pickup and delivery need an address');
    address = {
      id: found.id,
      label: found.label,
      area: found.area,
      block: found.block,
      road: found.road,
      building: found.building,
      ...(found.flat ? { flat: found.flat } : {}),
      ...(found.notes ? { notes: found.notes } : {}),
      ...(found.lat !== null && found.lng !== null ? { geo: { lat: found.lat, lng: found.lng } } : {}),
    };
  }
  const slotFor = (s: { date: string; slotId: string } | null | undefined, what: string) => {
    const def = a.slots.find((x) => x.id === s?.slotId);
    if (!s || !def || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) throw new AppError(400, 'invalid_order', `Choose a ${what} time`);
    return { s, def };
  };
  let pickupSlot: object | null = null;
  let pickupWindow: { date: string; endHour: number } | undefined;
  if (h.inbound === 'PICKUP') {
    const { s, def } = slotFor(input.pickupSlot, 'pickup');
    if (slotState(s.date, def, now) !== 'OPEN') throw new AppError(409, 'slot_unavailable', 'That pickup time is no longer available');
    pickupSlot = { date: s.date, slotId: def.id, label: { en: def.label, ar: def.labelAr || def.label }, startHour: def.startHour, endHour: def.endHour };
    pickupWindow = { date: s.date, endHour: def.endHour };
  }
  let deliverySlot: object | null = null;
  if (h.outbound === 'DELIVERY') {
    const { s, def } = slotFor(input.deliverySlot, 'delivery');
    const earliest = earliestDelivery(now, q.turnaroundHours, pickupWindow);
    if (slotState(s.date, def, now, earliest) !== 'OPEN') {
      throw new AppError(409, 'slot_unavailable', 'That delivery time is too early or no longer available');
    }
    deliverySlot = { date: s.date, slotId: def.id, label: { en: def.label, ar: def.labelAr || def.label }, startHour: def.startHour, endHour: def.endHour };
  }

  const total = q.priced.totals.total;
  if (input.expectedTotal !== undefined && input.expectedTotal !== null && input.expectedTotal !== toFils(total)) {
    throw new AppError(409, 'price_changed', 'The price changed since you reviewed it');
  }
  if (method === 'WALLET' && toFils(num(m.customer.walletPaid)) + toFils(num(m.customer.walletBonus)) < toFils(total)) {
    throw new AppError(400, 'insufficient_funds', 'Not enough balance in your wallet');
  }

  return m.db.$transaction(async (tx) => {
    const draft = await createOrder(tx, m.ctx, q.input, { park: true });
    for (let attempt = 0; ; attempt++) {
      try {
        await tx.order.update({
          where: { id: draft.id },
          data: {
            source: 'APP',
            appRef: newRef(),
            inbound: h.inbound,
            outbound: h.outbound,
            handoverStatus: h.inbound === 'PICKUP' ? 'AWAITING_PICKUP' : 'AWAITING_DROPOFF',
            addressId: input.addressId ?? null,
            address: address ?? undefined,
            pickupSlot: pickupSlot ?? undefined,
            deliverySlot: deliverySlot ?? undefined,
            appPaymentMethod: method,
            appIdempotencyKey: input.idempotencyKey,
            createdByName: 'Customer app',
          },
        });
        break;
      } catch (e) {
        // A reference clash is astronomically rare; try another one.
        if (attempt < 3 && (e as { code?: string }).code === 'P2002') continue;
        throw e;
      }
    }
    await tx.orderEvent.create({
      data: { tenantId: m.tenant.id, orderId: draft.id, type: 'CREATED', toStatus: 'DRAFT', note: 'Placed in the customer app', pieceCount: q.priced.pieceCount, userId: m.ctx.userId, userName: m.ctx.userName },
    });
    return draft.id;
  });
}

/** Customers can cancel until the shop has their clothes (nothing has been charged yet). */
export async function cancelByCustomer(m: Member, orderId: string) {
  const order = await m.db.order.findFirst({ where: { id: orderId, customerId: m.customer.id } });
  if (!order) throw new AppError(404, 'not_found', 'Order not found');
  if (order.source !== 'APP' || order.status !== 'DRAFT' || !['AWAITING_DROPOFF', 'AWAITING_PICKUP'].includes(order.handoverStatus ?? '')) {
    throw new AppError(409, 'invalid_order', 'This order is already with the laundry. Call them to change it.');
  }
  await m.db.$transaction((tx) => cancelOrder(tx, m.ctx, orderId, 'Cancelled by the customer in the app'));
}

// ───────────────────────────── Addresses ─────────────────────────────

export interface AddressInput {
  id?: string;
  label: string;
  area: string;
  block: string;
  road: string;
  building: string;
  flat?: string | null;
  notes?: string | null;
  geo?: { lat: number; lng: number } | null;
  isDefault?: boolean;
}

export async function saveAddress(m: Member, input: AddressInput) {
  return m.db.$transaction(async (tx) => {
    const existing = input.id ? await tx.customerAddress.findFirst({ where: { id: input.id, customerId: m.customer.id } }) : null;
    if (input.id && !existing) throw new AppError(404, 'not_found', 'Address not found');
    const count = await tx.customerAddress.count({ where: { customerId: m.customer.id } });
    const isDefault = !!input.isDefault || count === 0 || (existing?.isDefault ?? false);
    if (isDefault) await tx.customerAddress.updateMany({ where: { customerId: m.customer.id }, data: { isDefault: false } });
    const data = {
      label: input.label,
      area: input.area,
      block: input.block,
      road: input.road,
      building: input.building,
      flat: input.flat || null,
      notes: input.notes || null,
      lat: input.geo?.lat ?? null,
      lng: input.geo?.lng ?? null,
      isDefault,
    };
    return existing
      ? tx.customerAddress.update({ where: { id: existing.id }, data })
      : tx.customerAddress.create({ data: { ...data, tenantId: m.tenant.id, customerId: m.customer.id } });
  });
}

export async function deleteAddress(m: Member, id: string) {
  await m.db.$transaction(async (tx) => {
    const found = await tx.customerAddress.findFirst({ where: { id, customerId: m.customer.id } });
    if (!found) throw new AppError(404, 'not_found', 'Address not found');
    await tx.customerAddress.delete({ where: { id } });
    if (found.isDefault) {
      const next = await tx.customerAddress.findFirst({ where: { customerId: m.customer.id }, orderBy: { createdAt: 'asc' } });
      if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

// ───────────────────────────── Account ─────────────────────────────

/**
 * Delete the customer's app account: sessions, saved addresses and the link to
 * every shop. The shops keep their own customer record, orders and tax
 * invoices (they are the shop's books), and the wallet stays usable at the counter.
 */
export async function deleteAccount(prisma: PrismaClient, user: AppUser) {
  const customers = await prisma.customer.findMany({ where: { appUserId: user.id }, select: { id: true } });
  const ids = customers.map((c) => c.id);
  const open = await prisma.order.count({
    where: {
      customerId: { in: ids },
      OR: [{ status: { in: ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY'] } }, { status: 'DRAFT', source: 'APP' }],
    },
  });
  if (open > 0) throw new AppError(409, 'active_orders', 'You still have orders in progress. Collect them before deleting your account.');
  await prisma.$transaction([
    prisma.customerAddress.deleteMany({ where: { customerId: { in: ids } } }),
    prisma.customer.updateMany({ where: { id: { in: ids } }, data: { appUserId: null } }),
    prisma.appUser.delete({ where: { id: user.id } }),
  ]);
}

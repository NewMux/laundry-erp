import type { CustomerAddress, CustomerPackage, Order, OrderEvent, OrderItem, Payment, Prisma, Tenant, WalletTransaction } from '@prisma/client';
import {
  DEFAULT_WORKING_HOURS,
  WEEKDAYS,
  parseSettings,
  toFils,
  type AppSlot,
  type CustomerAppSettings,
  type WorkingHours,
} from '@laundry/shared';
import { num } from '../lib/prisma';
import type { TenantDb, TenantTx } from '../lib/tenant-db';

/**
 * The customer app's contract (laundry-customer-app, api/types.ts + lib/types.ts).
 * Money crosses this boundary as integer fils; names are { en, ar }.
 */

export interface Text {
  en: string;
  ar: string;
}
const text = (en: string, ar?: string | null): Text => ({ en, ar: ar?.trim() || en });

/** Illustrations the app ships with; anything else falls back to the nearest one. */
const APP_ICONS = new Set(['thobe', 'ghutra', 'abaya', 'shirt', 'trousers', 'suit', 'jacket', 'blanket', 'bedsheet', 'bisht']);
const ICON_FALLBACK: Record<string, string> = {
  tshirt: 'shirt',
  blouse: 'shirt',
  sweater: 'shirt',
  uniform: 'shirt',
  kids: 'shirt',
  tie: 'shirt',
  jeans: 'trousers',
  skirt: 'trousers',
  coat: 'jacket',
  sheila: 'ghutra',
  dress: 'abaya',
  wedding_dress: 'abaya',
  duvet: 'blanket',
  pillow: 'bedsheet',
  towel: 'bedsheet',
  curtain: 'bedsheet',
  carpet: 'blanket',
};
export function appIcon(imageKey: string | null | undefined): string {
  if (imageKey && APP_ICONS.has(imageKey)) return imageKey;
  return (imageKey && ICON_FALLBACK[imageKey]) || 'shirt';
}

const CURRENCY = { code: 'BHD', decimals: 3, symbol: { en: 'BHD', ar: 'د.ب' } } as const;
export const fils = (v: unknown) => toFils(num(v as never));

// ───────────────────────────── Laundry ─────────────────────────────

function workingHoursOf(t: Pick<Tenant, 'workingHours'>): WorkingHours {
  const wh = t.workingHours as unknown as WorkingHours;
  return wh && typeof wh === 'object' && 'sun' in wh ? wh : DEFAULT_WORKING_HOURS;
}

const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** "Sun–Thu 08:00–22:00 · Fri 16:00–22:00 · Sat closed" from the shop's structured hours. */
function hoursText(wh: WorkingHours): Text {
  const groups: { from: number; to: number; label: string; closed: boolean }[] = [];
  WEEKDAYS.forEach((d, i) => {
    const day = wh[d];
    const label = day.closed ? '' : `${day.open}–${day.close}`;
    const last = groups[groups.length - 1];
    if (last && last.label === label && last.closed === day.closed) last.to = i;
    else groups.push({ from: i, to: i, label, closed: day.closed });
  });
  const fmt = (names: string[], closed: string) =>
    groups.map((g) => `${g.from === g.to ? names[g.from] : `${names[g.from]}–${names[g.to]}`} ${g.closed ? closed : g.label}`).join(' · ');
  return { en: fmt(DAY_EN, 'closed'), ar: fmt(DAY_AR, 'مغلق') };
}

function openingHours(wh: WorkingHours) {
  const rules: { days: number[]; open: string; close: string }[] = [];
  WEEKDAYS.forEach((d, i) => {
    const day = wh[d];
    if (day.closed) return;
    const same = rules.find((r) => r.open === day.open && r.close === day.close);
    if (same) same.days.push(i);
    else rules.push({ days: [i], open: day.open, close: day.close });
  });
  return { timeZone: 'Asia/Bahrain', rules };
}

const slotOut = (s: AppSlot) => ({ id: s.id, label: text(s.label, s.labelAr), startHour: s.startHour, endHour: s.endHour });

export function appPayments(a: CustomerAppSettings): ('wallet' | 'card_counter' | 'cash_counter')[] {
  return [...(a.payWallet ? (['wallet'] as const) : []), ...(a.payCard ? (['card_counter'] as const) : []), ...(a.payCash ? (['cash_counter'] as const) : [])];
}

/** Category ids the app knows how to title; other shop categories pass through as written. */
const categoryId = (c: string | null) => (c?.trim() ? c.trim() : 'Other');

export async function laundryDto(db: TenantDb | TenantTx, t: Tenant) {
  const settings = parseSettings(t.settings);
  const a = settings.customerApp;
  const [items, services, prices] = await Promise.all([
    // Area-priced items (curtains, carpets) are measured at the counter, so they are not ordered in the app.
    db.itemType.findMany({ where: { isActive: true, unit: 'PIECE' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.serviceType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.priceListEntry.findMany({ where: { isActive: true } }),
  ]);
  const activeServices = new Set(services.map((s) => s.id));
  const garments = items
    .map((it) => {
      const own = prices.filter((p) => p.itemTypeId === it.id && activeServices.has(p.serviceTypeId));
      return {
        id: it.id,
        name: text(it.name, it.nameAr),
        category: categoryId(it.category),
        icon: appIcon(it.imageKey),
        prices: Object.fromEntries(own.map((p) => [p.serviceTypeId, fils(p.price)])),
        expressPrices: Object.fromEntries(own.filter((p) => p.expressPrice !== null).map((p) => [p.serviceTypeId, fils(p.expressPrice)])),
      };
    })
    .filter((g) => Object.keys(g.prices).length > 0);
  const offered = services.filter((s) => garments.some((g) => s.id in g.prices));
  const wh = workingHoursOf(t);
  const anyExpressPrice = prices.some((p) => p.expressPrice !== null);
  const expressEnabled = settings.expressSurchargeValue > 0 || anyExpressPrice;
  const percent = settings.expressSurchargeType === 'PERCENT';
  return {
    id: t.id,
    code: t.customerCode ?? '',
    name: text(t.name, t.nameAr),
    contact: {
      phone: t.phone ?? '',
      whatsapp: (t.phone ?? '').replace(/\D/g, ''),
      address: text(t.address ?? ''),
      hours: hoursText(wh),
    },
    hours: openingHours(wh),
    // Conservative: the slowest service, so the app never offers a delivery the shop can't make.
    turnaroundHours: Math.max(24, ...offered.map((s) => s.turnaroundHours)),
    legal: { crNumber: t.crNumber ?? '', vatNumber: t.vatNumber ?? '' },
    currency: CURRENCY,
    vatBps: Math.round(settings.vatRate * 100),
    pricesIncludeVat: settings.pricesIncludeVat,
    express: {
      enabled: expressEnabled,
      surchargeBps: percent ? Math.round(settings.expressSurchargeValue * 100) : 0,
      surchargeFixed: percent ? 0 : toFils(settings.expressSurchargeValue),
      promiseHours: Math.max(1, ...offered.map((s) => s.expressTurnaroundHours)),
    },
    services: offered.map((s) => s.id),
    serviceNames: Object.fromEntries(offered.map((s) => [s.id, text(s.name, s.nameAr)])),
    garments,
    payments: appPayments(a),
    fulfillment: {
      counter: a.counter,
      pickup: { enabled: a.pickup.enabled, fee: toFils(a.pickup.fee) },
      delivery: { enabled: a.delivery.enabled, fee: toFils(a.delivery.fee) },
      ...(a.roundTripFee !== null ? { roundTripFee: toFils(a.roundTripFee) } : {}),
      ...(a.freeAbove !== null ? { freeAbove: toFils(a.freeAbove) } : {}),
      slots: a.slots.map(slotOut),
    },
  };
}

// ───────────────────────────── Customer data ─────────────────────────────

export function addressDto(a: CustomerAddress) {
  return {
    id: a.id,
    label: a.label,
    area: a.area,
    block: a.block,
    road: a.road,
    building: a.building,
    ...(a.flat ? { flat: a.flat } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    ...(a.lat !== null && a.lng !== null ? { geo: { lat: a.lat, lng: a.lng } } : {}),
    isDefault: a.isDefault,
  };
}

/** Item-count packages; credit packages are already part of the wallet balance. */
export function packageDto(p: CustomerPackage) {
  return {
    id: p.id,
    name: text(p.name),
    covers: { garmentId: p.itemTypeId ?? '*', service: p.serviceTypeId ?? '*' },
    total: p.totalItems,
    remaining: p.status === 'ACTIVE' ? p.remainingItems : 0,
    // No expiry: shown as far in the future.
    expiresAt: (p.expiresAt ?? new Date('2099-12-31T00:00:00Z')).toISOString(),
  };
}

const TXN_TITLE: Record<string, Text> = {
  TOPUP: { en: 'Top-up', ar: 'شحن الرصيد' },
  PACKAGE: { en: 'Package', ar: 'باقة' },
  ORDER_PAYMENT: { en: 'Order', ar: 'طلب' },
  ORDER_REFUND: { en: 'Refund', ar: 'استرداد' },
  REFUND: { en: 'Balance refunded', ar: 'إرجاع الرصيد' },
  ADJUSTMENT: { en: 'Adjustment', ar: 'تعديل' },
  EXPIRY: { en: 'Bonus expired', ar: 'انتهاء الرصيد الإضافي' },
};
const METHOD_OUT: Record<string, string> = {
  CASH: 'cash_counter',
  CARD: 'card_counter',
  BENEFIT_PAY: 'benefitpay',
  BANK_TRANSFER: 'card_counter',
  WALLET: 'wallet',
  PACKAGE: 'wallet',
};

export function transactionDto(t: WalletTransaction, payment: Pick<Payment, 'method'> | undefined, orderNo: number | null | undefined) {
  const base = TXN_TITLE[t.type] ?? TXN_TITLE.ADJUSTMENT;
  const suffix = orderNo ? ` #${orderNo}` : '';
  const bonusOnly = toFils(num(t.paidDelta)) === 0 && toFils(num(t.bonusDelta)) !== 0;
  return {
    id: t.id,
    laundryId: t.tenantId,
    title: { en: `${base.en}${suffix}`, ar: `${base.ar}${suffix}` },
    at: t.createdAt.toISOString(),
    amount: toFils(num(t.paidDelta)) + toFils(num(t.bonusDelta)),
    method: payment ? (METHOD_OUT[payment.method] ?? 'wallet') : bonusOnly ? 'promo' : 'wallet',
    ...(t.orderId ? { orderId: t.orderId } : {}),
  };
}

// ───────────────────────────── Orders ─────────────────────────────

type OrderFull = Order & { items: OrderItem[]; events: Pick<OrderEvent, 'toStatus' | 'createdAt'>[] };
/** Item illustration and Arabic name by item type id (order lines keep only the name as sold). */
export type ItemLook = Map<string, { imageKey: string | null; nameAr: string | null }>;

export async function itemLooks(db: TenantDb | TenantTx, orders: { items: Pick<OrderItem, 'itemTypeId'>[] }[]): Promise<ItemLook> {
  const ids = [...new Set(orders.flatMap((o) => o.items.map((i) => i.itemTypeId)).filter((x): x is string => !!x))];
  const items = ids.length ? await db.itemType.findMany({ where: { id: { in: ids } }, select: { id: true, imageKey: true, nameAr: true } }) : [];
  return new Map(items.map((i) => [i.id, { imageKey: i.imageKey, nameAr: i.nameAr }]));
}

const STATUS_OUT: Record<string, string> = {
  RECEIVED: 'received',
  IN_PROCESS: 'processing',
  IRONING: 'ironing',
  READY: 'ready',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};
const HANDOVER_OUT: Record<string, string> = {
  AWAITING_DROPOFF: 'awaiting_dropoff',
  AWAITING_PICKUP: 'awaiting_pickup',
  PICKUP_EN_ROUTE: 'pickup_en_route',
};

/** The app's status: the handover step while it applies, otherwise the workshop status. */
export function appStatus(o: Pick<Order, 'status' | 'handoverStatus'>): string {
  if (o.status === 'CANCELLED') return 'cancelled';
  if (o.status === 'DRAFT') return HANDOVER_OUT[o.handoverStatus ?? ''] ?? 'awaiting_dropoff';
  if (o.status === 'READY' && o.handoverStatus === 'OUT_FOR_DELIVERY') return 'out_for_delivery';
  return STATUS_OUT[o.status] ?? 'received';
}

interface SlotJson {
  date: string;
  slotId: string;
  label: Text;
  startHour?: number;
  endHour?: number;
}
const slotJson = (v: unknown) => {
  const s = v as SlotJson | null;
  return s ? { date: s.date, slotId: s.slotId, label: s.label } : undefined;
};

export function orderDto(o: OrderFull, payments: Pick<Payment, 'method' | 'kind' | 'amount'>[], looks: ItemLook) {
  const firstAt = (to: string) => o.events.filter((e) => e.toStatus === to).sort((a, b) => +a.createdAt - +b.createdAt)[0]?.createdAt.toISOString();
  const timeline: Record<string, string> = {};
  if (o.source === 'APP') timeline[o.inbound === 'PICKUP' ? 'awaiting_pickup' : 'awaiting_dropoff'] = o.createdAt.toISOString();
  const enRoute = firstAt('PICKUP_EN_ROUTE');
  if (enRoute) timeline.pickup_en_route = enRoute;
  if (o.receivedAt) timeline.received = o.receivedAt.toISOString();
  const processing = firstAt('IN_PROCESS');
  if (processing) timeline.processing = processing;
  const ironing = firstAt('IRONING');
  if (ironing) timeline.ironing = ironing;
  if (o.readyAt) timeline.ready = o.readyAt.toISOString();
  const out = firstAt('OUT_FOR_DELIVERY');
  if (out) timeline.out_for_delivery = out;
  if (o.deliveredAt) timeline.delivered = o.deliveredAt.toISOString();
  if (o.cancelledAt) timeline.cancelled = o.cancelledAt.toISOString();

  const orderPayments = payments.filter((p) => p.kind === 'ORDER' && num(p.amount) > 0);
  const method = o.appPaymentMethod ?? orderPayments[0]?.method ?? 'CASH';
  const paid = o.paymentState === 'PAID' && toFils(num(o.total)) > 0;
  const subtotal = o.items.reduce((s, it) => s + toFils(num(it.lineTotal)), 0);
  return {
    id: o.id,
    laundryId: o.tenantId,
    number: o.orderNo !== null ? String(o.orderNo) : (o.appRef ?? ''),
    createdAt: o.createdAt.toISOString(),
    status: appStatus(o),
    ...(o.expectedAt ? { readyBy: o.expectedAt.toISOString() } : {}),
    timeline,
    currency: CURRENCY,
    lines: o.items.map((it) => ({
      garmentId: it.itemTypeId ?? '',
      name: text(it.itemName, it.itemTypeId ? looks.get(it.itemTypeId)?.nameAr : null),
      icon: appIcon(it.itemTypeId ? looks.get(it.itemTypeId)?.imageKey : null),
      service: it.serviceTypeId ?? '',
      serviceName: text(it.serviceName),
      quantity: it.quantity,
      unitPrice: fils(it.unitPrice),
      coveredByPackage: it.customerPackageId ? it.quantity : 0,
      packageUse: it.customerPackageId ? [{ packageId: it.customerPackageId, count: it.quantity }] : [],
      lineTotal: fils(it.lineTotal),
      ...(it.notes ? { note: it.notes } : {}),
    })),
    totals: {
      subtotal,
      expressFee: fils(o.expressSurcharge),
      driverFee: fils(o.driverFee),
      discount: fils(o.discountTotal),
      taxable: fils(o.netAmount),
      vat: fils(o.vatAmount),
      total: fils(o.total),
    },
    vatBps: Math.round(num(o.vatRate) * 100),
    express: o.express,
    handover: { inbound: o.inbound === 'PICKUP' ? 'pickup' : 'dropoff', outbound: o.outbound === 'DELIVERY' ? 'delivery' : 'collect' },
    ...(o.address ? { address: o.address } : {}),
    ...(o.pickupSlot ? { pickupSlot: slotJson(o.pickupSlot) } : {}),
    ...(o.deliverySlot ? { deliverySlot: slotJson(o.deliverySlot) } : {}),
    notes: o.notes ?? '',
    payment: {
      method: METHOD_OUT[method] ?? 'cash_counter',
      status: paid ? 'paid' : o.status === 'DRAFT' && o.appPaymentMethod === 'WALLET' ? 'due_on_receipt' : 'pay_at_counter',
    },
    // What the shop scans: the receipt barcode once numbered, the app reference before that.
    pickupToken: o.orderNo !== null ? `O${o.orderNo}` : (o.appRef ?? ''),
  };
}

export const ORDER_INCLUDE = {
  items: { orderBy: { lineNo: 'asc' } },
  events: { where: { toStatus: { in: ['PICKUP_EN_ROUTE', 'IN_PROCESS', 'IRONING', 'OUT_FOR_DELIVERY'] } }, select: { toStatus: true, createdAt: true } },
  payments: { select: { method: true, kind: true, amount: true } },
} satisfies Prisma.OrderInclude;

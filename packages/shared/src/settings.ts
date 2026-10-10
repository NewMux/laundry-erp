import { z } from 'zod';

/** Per-tenant settings, stored as JSON on the tenant. */
export const receiptSettingsSchema = z.object({
  showLogo: z.boolean().default(true),
  header: z.string().max(500).default(''),
  footer: z.string().max(500).default('Thank you for your visit!'),
  terms: z
    .string()
    .max(2000)
    .default('Items not collected within 30 days may be donated. We are not responsible for items left in pockets.'),
  showVatNumber: z.boolean().default(true),
  showCustomerPhone: z.boolean().default(true),
  showDamageNotes: z.boolean().default(true),
  showQr: z.boolean().default(true),
  showItemPrices: z.boolean().default(true),
  showExpectedDate: z.boolean().default(true),
  showWalletBalance: z.boolean().default(true),
  showCashier: z.boolean().default(true),
  copies: z.number().int().min(1).max(3).default(1),
});

export const tagSettingsSchema = z.object({
  /** LABEL = thermal label printer; PAPER = 80mm receipt paper, one tag per cut. */
  format: z.enum(['LABEL', 'PAPER']).default('PAPER'),
  labelWidthMm: z.number().min(25).max(80).default(50),
  labelHeightMm: z.number().min(15).max(80).default(30),
  showCustomerName: z.boolean().default(true),
  showService: z.boolean().default(true),
  showColor: z.boolean().default(true),
  showExpectedDate: z.boolean().default(false),
});

export const invoiceSettingsSchema = z.object({
  showLogo: z.boolean().default(true),
  footer: z.string().max(1000).default(''),
  terms: z.string().max(2000).default(''),
  bankDetails: z.string().max(1000).default(''),
});

export const whatsappSettingsSchema = z.object({
  orderReady: z
    .string()
    .max(1000)
    .default('Dear {customer}, your order #{orderNo} at {shop} is ready for pickup. Amount due: {due}. Thank you!'),
  receiptShare: z
    .string()
    .max(1000)
    .default('Dear {customer}, thank you for your order #{orderNo} at {shop}. Total: {total}. Expected ready: {expected}. Receipt: {link}'),
  statementShare: z.string().max(1000).default('Dear {customer}, please find your statement from {shop}: {link}'),
});

/** A time window drivers run in, e.g. 9–12 "Morning". Hours are Bahrain time. */
export const appSlotSchema = z
  .object({
    id: z.string().trim().min(1).max(20),
    label: z.string().trim().min(1).max(40),
    labelAr: z.string().trim().max(40).default(''),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .refine((s) => s.endHour > s.startHour, { message: 'A window must end after it starts', path: ['endHour'] });

export const DEFAULT_APP_SLOTS = [
  { id: 'morning', label: 'Morning', labelAr: 'صباحًا', startHour: 9, endHour: 12 },
  { id: 'afternoon', label: 'Afternoon', labelAr: 'ظهرًا', startHour: 12, endHour: 16 },
  { id: 'evening', label: 'Evening', labelAr: 'مساءً', startHour: 16, endHour: 20 },
];

const legSchema = z.object({ enabled: z.boolean().default(false), fee: z.number().min(0).max(1000).default(0) });

/**
 * The customer app, set up by each shop: whether it is on, which handovers
 * it offers (counter, driver pickup, driver delivery), what drivers cost and
 * when they run, and how customers may pay.
 */
export const customerAppSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Customers can drop off and collect at the shop. */
    counter: z.boolean().default(true),
    pickup: legSchema.prefault({}),
    delivery: legSchema.prefault({}),
    /** Charged instead of pickup + delivery when a customer books both. */
    roundTripFee: z.number().min(0).max(1000).nullable().default(null),
    /** Driver fees are waived once the order value (before VAT) reaches this. */
    freeAbove: z.number().min(0).max(100000).nullable().default(null),
    slots: z.array(appSlotSchema).max(8).default(DEFAULT_APP_SLOTS),
    /** Payment options shown in the app. Wallet is charged when the order is received. */
    payWallet: z.boolean().default(true),
    payCard: z.boolean().default(true),
    payCash: z.boolean().default(true),
  })
  .refine((a) => a.counter || (a.pickup.enabled && a.delivery.enabled), {
    message: 'Without counter service, both pickup and delivery must be on',
    path: ['counter'],
  })
  .refine((a) => !(a.pickup.enabled || a.delivery.enabled) || a.slots.length > 0, {
    message: 'Add at least one time window for drivers',
    path: ['slots'],
  });

export type CustomerAppSettings = z.infer<typeof customerAppSettingsSchema>;
export type AppSlot = z.infer<typeof appSlotSchema>;

export const tenantSettingsSchema = z.object({
  vatRate: z.number().min(0).max(100).default(10),
  pricesIncludeVat: z.boolean().default(false),
  expressSurchargeType: z.enum(['AMOUNT', 'PERCENT']).default('PERCENT'),
  expressSurchargeValue: z.number().min(0).default(50),
  uncollectedDays: z.number().int().min(1).max(365).default(30),
  sessionTimeoutMinutes: z.number().int().min(5).max(24 * 60).default(480),
  defaultOpeningFloat: z.number().min(0).default(0),
  annualLeaveDays: z.number().min(0).max(365).default(30),
  sickLeaveDays: z.number().min(0).max(365).default(15),
  requirePaymentBeforeDelivery: z.boolean().default(true),
  receipt: receiptSettingsSchema.prefault({}),
  tag: tagSettingsSchema.prefault({}),
  invoice: invoiceSettingsSchema.prefault({}),
  whatsapp: whatsappSettingsSchema.prefault({}),
  customerApp: customerAppSettingsSchema.prefault({}),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
export type ReceiptSettings = z.infer<typeof receiptSettingsSchema>;
export type TagSettings = z.infer<typeof tagSettingsSchema>;

/** Parse stored settings, filling defaults for anything missing. */
export function parseSettings(raw: unknown): TenantSettings {
  const r = tenantSettingsSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  return tenantSettingsSchema.parse({});
}

/** Fill a message template like "Dear {customer}" with values. */
export function fillTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

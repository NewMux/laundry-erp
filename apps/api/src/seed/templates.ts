/**
 * Default price list templates offered during self-onboarding.
 * Prices are BHD (excl. VAT unless the tenant sets prices-include-VAT).
 * The owner edits everything afterwards.
 */

export interface ServiceSeed {
  key: string;
  name: string;
  iconKey: string;
  requiresProcessing: boolean;
  requiresIroning: boolean;
  turnaroundHours: number;
  expressTurnaroundHours: number;
}

export const SERVICES: ServiceSeed[] = [
  { key: 'WI', name: 'Wash & Iron', iconKey: 'wash_iron', requiresProcessing: true, requiresIroning: true, turnaroundHours: 48, expressTurnaroundHours: 24 },
  { key: 'IO', name: 'Iron Only', iconKey: 'iron', requiresProcessing: false, requiresIroning: true, turnaroundHours: 24, expressTurnaroundHours: 6 },
  { key: 'DC', name: 'Dry Clean', iconKey: 'dry_clean', requiresProcessing: true, requiresIroning: true, turnaroundHours: 72, expressTurnaroundHours: 24 },
  { key: 'WO', name: 'Wash Only', iconKey: 'wash', requiresProcessing: true, requiresIroning: false, turnaroundHours: 48, expressTurnaroundHours: 24 },
  { key: 'DY', name: 'Dyeing', iconKey: 'dye', requiresProcessing: true, requiresIroning: false, turnaroundHours: 120, expressTurnaroundHours: 72 },
];

type P = number | null;
export interface ItemSeed {
  name: string;
  imageKey: string;
  category: string;
  unit?: 'PIECE' | 'SQM';
  /** prices by service key */
  prices: Partial<Record<'WI' | 'IO' | 'DC' | 'WO' | 'DY', P>>;
}

const row = (WI: P, IO: P, DC: P, WO: P, DY: P = null) => ({ WI, IO, DC, WO, DY });

export const STANDARD_ITEMS: ItemSeed[] = [
  { name: 'Thobe', imageKey: 'thobe', category: 'Men', prices: row(0.4, 0.2, 0.8, 0.3, 2.5) },
  { name: 'Ghutra', imageKey: 'ghutra', category: 'Men', prices: row(0.3, 0.15, 0.6, 0.2) },
  { name: 'Bisht', imageKey: 'bisht', category: 'Men', prices: row(null, 1.0, 3.0, null) },
  { name: 'Shirt', imageKey: 'shirt', category: 'Men', prices: row(0.3, 0.15, 0.7, 0.25) },
  { name: 'T-Shirt', imageKey: 'tshirt', category: 'Casual', prices: row(0.25, 0.15, null, 0.2) },
  { name: 'Trousers', imageKey: 'trousers', category: 'Men', prices: row(0.35, 0.2, 0.7, 0.25, 2.0) },
  { name: 'Jeans', imageKey: 'jeans', category: 'Casual', prices: row(0.4, 0.2, null, 0.3, 2.0) },
  { name: 'Suit (2 pcs)', imageKey: 'suit', category: 'Formal', prices: row(1.5, 0.8, 2.0, null) },
  { name: 'Jacket / Blazer', imageKey: 'jacket', category: 'Formal', prices: row(0.9, 0.5, 1.2, null) },
  { name: 'Coat', imageKey: 'coat', category: 'Formal', prices: row(null, 0.8, 2.0, null) },
  { name: 'Abaya', imageKey: 'abaya', category: 'Women', prices: row(0.7, 0.3, 1.0, 0.5, 2.5) },
  { name: 'Sheila', imageKey: 'sheila', category: 'Women', prices: row(0.25, 0.15, 0.4, 0.2, 1.0) },
  { name: 'Dress', imageKey: 'dress', category: 'Women', prices: row(0.9, 0.5, 1.5, 0.7, 3.0) },
  { name: 'Skirt', imageKey: 'skirt', category: 'Women', prices: row(0.5, 0.3, 0.8, 0.4) },
  { name: 'Blouse', imageKey: 'blouse', category: 'Women', prices: row(0.4, 0.2, 0.7, 0.3) },
  { name: 'Sweater', imageKey: 'sweater', category: 'Casual', prices: row(0.6, 0.3, 1.0, 0.5) },
  { name: 'Kids Wear', imageKey: 'kids', category: 'Kids', prices: row(0.25, 0.15, 0.5, 0.2) },
  { name: 'Uniform', imageKey: 'uniform', category: 'Work', prices: row(0.5, 0.25, 0.8, 0.4) },
  { name: 'Tie', imageKey: 'tie', category: 'Formal', prices: row(null, 0.2, 0.5, null) },
  { name: 'Wedding Dress', imageKey: 'wedding_dress', category: 'Women', prices: row(null, 5.0, 15.0, null) },
  { name: 'Bed Sheet', imageKey: 'bedsheet', category: 'Household', prices: row(0.6, 0.4, null, 0.5) },
  { name: 'Blanket', imageKey: 'blanket', category: 'Household', prices: row(2.5, null, 3.5, 2.0) },
  { name: 'Duvet', imageKey: 'duvet', category: 'Household', prices: row(3.0, null, 4.0, 2.5) },
  { name: 'Pillow', imageKey: 'pillow', category: 'Household', prices: row(1.0, null, null, 0.8) },
  { name: 'Towel', imageKey: 'towel', category: 'Household', prices: row(0.3, null, null, 0.25) },
  { name: 'Curtain (per m²)', imageKey: 'curtain', category: 'Household', unit: 'SQM', prices: row(0.8, 0.4, 1.2, 0.6) },
  { name: 'Carpet (per m²)', imageKey: 'carpet', category: 'Household', unit: 'SQM', prices: row(null, null, 1.5, 1.0) },
];

const DRY_CLEANER_KEYS = ['thobe', 'ghutra', 'bisht', 'shirt', 'trousers', 'suit', 'jacket', 'coat', 'abaya', 'dress', 'skirt', 'blouse', 'sweater', 'tie', 'wedding_dress', 'curtain'];

export const PRICE_TEMPLATES = {
  standard: { name: 'Standard laundry (Bahrain)', items: STANDARD_ITEMS },
  dry_cleaner: {
    name: 'Dry cleaner',
    items: STANDARD_ITEMS.filter((i) => DRY_CLEANER_KEYS.includes(i.imageKey)).map((i) => ({
      ...i,
      prices: { IO: i.prices.IO ?? null, DC: i.prices.DC ?? null, WI: i.prices.WI ?? null },
    })),
  },
  empty: { name: 'Start empty (services only)', items: [] as ItemSeed[] },
} as const;

export type PriceTemplateKey = keyof typeof PRICE_TEMPLATES;

export const DEFAULT_PACKAGES = [
  { name: 'Pay BHD 20, get BHD 25', kind: 'CREDIT' as const, price: 20, creditValue: 25, validityDays: null, sortOrder: 1 },
  { name: 'Pay BHD 50, get BHD 65', kind: 'CREDIT' as const, price: 50, creditValue: 65, validityDays: null, sortOrder: 2 },
  { name: '30 Thobes Wash & Iron', kind: 'ITEMS' as const, price: 10, itemCount: 30, itemKey: 'thobe', serviceKey: 'WI', validityDays: 90, sortOrder: 3 },
];

export const DEFAULT_PLANS = [
  { code: 'starter', name: 'Starter', priceMonthly: 15, maxUsers: 3, features: { customPermissions: false, dataExport: true }, sortOrder: 1 },
  { code: 'business', name: 'Business', priceMonthly: 25, maxUsers: 8, features: { customPermissions: true, dataExport: true }, sortOrder: 2 },
  { code: 'premium', name: 'Premium', priceMonthly: 40, maxUsers: 25, features: { customPermissions: true, dataExport: true }, sortOrder: 3 },
];

export const TRIAL_DAYS = 14;

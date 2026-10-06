import type { DiscountType, ItemUnit } from './enums';

/**
 * Money is BHD with 3 decimals. All arithmetic is done in integer fils
 * (1 BHD = 1000 fils) to avoid floating point drift; values cross API
 * boundaries as BHD numbers with at most 3 decimals.
 */
export const FILS = 1000;

export function toFils(bhd: number | string | null | undefined): number {
  if (bhd === null || bhd === undefined || bhd === '') return 0;
  const n = typeof bhd === 'string' ? Number(bhd) : bhd;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * FILS);
}

export function fromFils(fils: number): number {
  return Math.round(fils) / FILS;
}

/** Round a BHD amount to 3 decimals. */
export function round3(bhd: number): number {
  return fromFils(toFils(bhd));
}

export function formatBhd(bhd: number | string | null | undefined, withCurrency = true): string {
  const fils = toFils(bhd as number);
  const sign = fils < 0 ? '-' : '';
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / FILS);
  const frac = String(abs % FILS).padStart(3, '0');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${withCurrency ? 'BHD ' : ''}${wholeStr}.${frac}`;
}

function pct(fils: number, percent: number): number {
  return Math.round((fils * percent) / 100);
}

export interface CalcLineInput {
  unitPrice: number; // BHD
  unit: ItemUnit;
  quantity: number; // pieces
  area?: number | null; // m² (SQM items: billed on area)
  discountType?: DiscountType | null;
  discountValue?: number | null; // BHD for AMOUNT, % for PERCENT
  coveredByPackage?: boolean;
}

export interface CalcOrderInput {
  lines: CalcLineInput[];
  express: boolean;
  expressSurchargeType: DiscountType; // AMOUNT (fixed per order) or PERCENT
  expressSurchargeValue: number;
  orderDiscountType?: DiscountType | null;
  orderDiscountValue?: number | null;
  vatRate: number; // e.g. 10
  pricesIncludeVat: boolean;
}

export interface CalcLineResult {
  gross: number;
  discount: number;
  net: number;
}

export interface CalcOrderResult {
  lines: CalcLineResult[];
  subtotal: number; // sum of line gross
  lineDiscountTotal: number;
  expressSurcharge: number;
  orderDiscount: number;
  discountTotal: number;
  /** Value before discounts (gross + surcharge); base for discount-limit checks. */
  discountBase: number;
  discountPercent: number;
  netAmount: number; // excl. VAT
  vatAmount: number;
  total: number; // incl. VAT
}

/** Billable units for a line: pieces, or m² for area-priced items. */
export function billableUnits(line: Pick<CalcLineInput, 'unit' | 'quantity' | 'area'>): number {
  if (line.unit === 'SQM') return Number(line.area ?? 0);
  return Number(line.quantity ?? 0);
}

export function calcOrder(input: CalcOrderInput): CalcOrderResult {
  const lines: CalcLineResult[] = input.lines.map((l) => {
    const gross = l.coveredByPackage ? 0 : Math.round(toFils(l.unitPrice) * billableUnits(l));
    let discount = 0;
    if (l.discountType && l.discountValue) {
      discount = l.discountType === 'PERCENT' ? pct(gross, Math.min(100, l.discountValue)) : toFils(l.discountValue);
    }
    discount = Math.max(0, Math.min(discount, gross));
    return { gross, discount, net: gross - discount };
  });

  const subtotal = lines.reduce((s, l) => s + l.gross, 0);
  const lineDiscountTotal = lines.reduce((s, l) => s + l.discount, 0);
  const afterLines = subtotal - lineDiscountTotal;

  let expressSurcharge = 0;
  if (input.express && input.expressSurchargeValue > 0 && subtotal > 0) {
    expressSurcharge =
      input.expressSurchargeType === 'PERCENT'
        ? pct(afterLines, input.expressSurchargeValue)
        : toFils(input.expressSurchargeValue);
  }

  const base = afterLines + expressSurcharge;
  let orderDiscount = 0;
  if (input.orderDiscountType && input.orderDiscountValue) {
    orderDiscount =
      input.orderDiscountType === 'PERCENT'
        ? pct(base, Math.min(100, input.orderDiscountValue))
        : toFils(input.orderDiscountValue);
  }
  orderDiscount = Math.max(0, Math.min(orderDiscount, base));

  const afterDiscount = base - orderDiscount;
  let netAmount: number;
  let vatAmount: number;
  let total: number;
  if (input.pricesIncludeVat) {
    total = afterDiscount;
    vatAmount = Math.round((total * input.vatRate) / (100 + input.vatRate));
    netAmount = total - vatAmount;
  } else {
    netAmount = afterDiscount;
    vatAmount = pct(netAmount, input.vatRate);
    total = netAmount + vatAmount;
  }

  const discountTotal = lineDiscountTotal + orderDiscount;
  const discountBase = subtotal + expressSurcharge;
  const discountPercent = discountBase > 0 ? (discountTotal / discountBase) * 100 : 0;

  const f = fromFils;
  return {
    lines: lines.map((l) => ({ gross: f(l.gross), discount: f(l.discount), net: f(l.net) })),
    subtotal: f(subtotal),
    lineDiscountTotal: f(lineDiscountTotal),
    expressSurcharge: f(expressSurcharge),
    orderDiscount: f(orderDiscount),
    discountTotal: f(discountTotal),
    discountBase: f(discountBase),
    discountPercent: Math.round(discountPercent * 100) / 100,
    netAmount: f(netAmount),
    vatAmount: f(vatAmount),
    total: f(total),
  };
}

/** VAT contained in a gross (VAT-inclusive) amount, proportional to an invoice. */
export function vatShare(amount: number, invoiceVat: number, invoiceTotal: number): number {
  const total = toFils(invoiceTotal);
  if (total === 0) return 0;
  return fromFils(Math.round((toFils(amount) * toFils(invoiceVat)) / total));
}

/**
 * Split a wallet deduction between paid credit and bonus credit,
 * proportionally to the current balances.
 */
export function splitWalletUse(amount: number, paidBalance: number, bonusBalance: number): { paid: number; bonus: number } {
  const a = toFils(amount);
  const p = Math.max(0, toFils(paidBalance));
  const b = Math.max(0, toFils(bonusBalance));
  const totalBal = p + b;
  if (a <= 0 || totalBal <= 0) return { paid: 0, bonus: 0 };
  let paid = Math.round((a * p) / totalBal);
  paid = Math.min(paid, p);
  let bonus = a - paid;
  if (bonus > b) {
    paid += bonus - b;
    bonus = b;
  }
  return { paid: fromFils(paid), bonus: fromFils(bonus) };
}

export function sumBhd(values: Array<number | string | null | undefined>): number {
  return fromFils(values.reduce<number>((s, v) => s + toFils(v as number), 0));
}

export function subBhd(a: number, b: number): number {
  return fromFils(toFils(a) - toFils(b));
}

export function addBhd(a: number, b: number): number {
  return fromFils(toFils(a) + toFils(b));
}

export function mulBhd(a: number, factor: number): number {
  return fromFils(Math.round(toFils(a) * factor));
}

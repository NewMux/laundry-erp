import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_WORKING_HOURS,
  bhDate,
  calcOrder,
  can,
  expectedReadyAt,
  formatBhd,
  formatMobile,
  nextPieceStatus,
  normalizeMobile,
  orderStatusFromPieces,
  parseScan,
  parseSettings,
  sanitizePermissions,
  splitWalletUse,
  stepsFor,
  vatShare,
} from '../src';

const base = { express: false, expressSurchargeType: 'PERCENT' as const, expressSurchargeValue: 50, vatRate: 10, pricesIncludeVat: false };

describe('calcOrder', () => {
  it('adds 10% VAT on top in fils without float drift', () => {
    const r = calcOrder({ ...base, lines: [{ unitPrice: 0.1, unit: 'PIECE', quantity: 3 }, { unitPrice: 0.2, unit: 'PIECE', quantity: 1 }] });
    expect(r.subtotal).toBe(0.5);
    expect(r.vatAmount).toBe(0.05);
    expect(r.total).toBe(0.55);
  });

  it('extracts VAT when prices include VAT', () => {
    const r = calcOrder({ ...base, pricesIncludeVat: true, lines: [{ unitPrice: 1.1, unit: 'PIECE', quantity: 1 }] });
    expect(r.total).toBe(1.1);
    expect(r.vatAmount).toBe(0.1);
    expect(r.netAmount).toBe(1);
  });

  it('applies the express surcharge after line discounts and before the order discount', () => {
    const r = calcOrder({
      ...base,
      express: true,
      lines: [{ unitPrice: 1, unit: 'PIECE', quantity: 2, discountType: 'AMOUNT', discountValue: 0.5 }],
      orderDiscountType: 'PERCENT',
      orderDiscountValue: 10,
    });
    // 2.000 − 0.500 = 1.500; +50% = 2.250; −10% = 2.025; VAT 0.203 (rounded)
    expect(r.lineDiscountTotal).toBe(0.5);
    expect(r.expressSurcharge).toBe(0.75);
    expect(r.orderDiscount).toBe(0.225);
    expect(r.netAmount).toBe(2.025);
    expect(r.vatAmount).toBe(0.203);
    expect(r.total).toBe(2.228);
    expect(r.discountPercent).toBeCloseTo((0.725 / 2.75) * 100, 1);
  });

  it('prices m² items on area and zeroes package-covered lines', () => {
    const r = calcOrder({
      ...base,
      lines: [
        { unitPrice: 1.5, unit: 'SQM', quantity: 1, area: 6.5 },
        { unitPrice: 0.4, unit: 'PIECE', quantity: 10, coveredByPackage: true },
      ],
    });
    expect(r.lines[0].gross).toBe(9.75);
    expect(r.lines[1].gross).toBe(0);
    expect(r.total).toBe(10.725);
  });

  it('never discounts below zero', () => {
    const r = calcOrder({ ...base, lines: [{ unitPrice: 0.3, unit: 'PIECE', quantity: 1, discountType: 'AMOUNT', discountValue: 5 }] });
    expect(r.total).toBe(0);
  });
});

describe('wallet split & VAT share', () => {
  it('splits a wallet payment proportionally between paid and bonus credit', () => {
    expect(splitWalletUse(2.2, 20, 5)).toEqual({ paid: 1.76, bonus: 0.44 });
    expect(splitWalletUse(5, 0, 5)).toEqual({ paid: 0, bonus: 5 });
    const s = splitWalletUse(1, 0.333, 0.667);
    expect(s.paid + s.bonus).toBeCloseTo(1, 6);
  });
  it('computes the VAT contained in part of an invoice', () => {
    expect(vatShare(1.1, 0.1, 1.1)).toBe(0.1);
    expect(vatShare(0.55, 0.1, 1.1)).toBe(0.05);
    expect(vatShare(1, 0, 0)).toBe(0);
  });
});

describe('status flow', () => {
  const washIron = { requiresProcessing: true, requiresIroning: true };
  const ironOnly = { requiresProcessing: false, requiresIroning: true };
  const washOnly = { requiresProcessing: true, requiresIroning: false };
  it('skips steps a service does not need', () => {
    expect(stepsFor(washIron)).toEqual(['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY']);
    expect(nextPieceStatus('RECEIVED', ironOnly)).toBe('IRONING');
    expect(nextPieceStatus('IN_PROCESS', washOnly)).toBe('READY');
    expect(nextPieceStatus('READY', washIron)).toBeNull();
  });
  it('derives the order status from its least advanced open piece', () => {
    expect(orderStatusFromPieces([{ status: 'READY' }, { status: 'IRONING' }])).toBe('IRONING');
    expect(orderStatusFromPieces([{ status: 'READY' }, { status: 'DELIVERED' }])).toBe('READY');
    expect(orderStatusFromPieces([{ status: 'DELIVERED' }])).toBe('DELIVERED');
  });
});

describe('scan codes, phones, money format', () => {
  it('parses tag and receipt barcodes', () => {
    expect(parseScan('1042-3')).toEqual({ orderNo: 1042, pieceNo: 3 });
    expect(parseScan('O1042')).toEqual({ orderNo: 1042, pieceNo: null });
    expect(parseScan(' 1042 ')).toEqual({ orderNo: 1042, pieceNo: null });
    expect(parseScan('hello')).toBeNull();
  });
  it('normalises Bahrain mobiles', () => {
    expect(normalizeMobile('3311 2233')).toBe('97333112233');
    expect(normalizeMobile('+973 3311-2233')).toBe('97333112233');
    expect(normalizeMobile('0097333112233')).toBe('97333112233');
    expect(formatMobile('97333112233')).toBe('+973 3311 2233');
  });
  it('formats BHD with 3 decimals and thousands separators', () => {
    expect(formatBhd(1234.5)).toBe('BHD 1,234.500');
    expect(formatBhd(-0.1, false)).toBe('-0.100');
  });
});

describe('Bahrain time & expected ready time', () => {
  it('uses Asia/Bahrain business dates', () => {
    expect(bhDate(new Date('2026-10-05T22:30:00Z'))).toBe('2026-10-06');
  });
  it('pushes a ready time after closing to the next opening', () => {
    // Sunday 21:00 + 2h = 23:00 → after 22:00 closing → Monday 08:00
    const t = expectedReadyAt(new Date('2026-10-04T18:00:00Z'), 2, DEFAULT_WORKING_HOURS);
    expect(t.toISOString()).toBe('2026-10-05T05:00:00.000Z');
  });
  it('keeps a ready time inside working hours', () => {
    const t = expectedReadyAt(new Date('2026-10-05T06:00:00Z'), 3, DEFAULT_WORKING_HOURS);
    expect(t.toISOString()).toBe('2026-10-05T09:00:00.000Z');
  });
});

describe('permissions & settings', () => {
  it('cashiers cannot see reports or cancel paid invoices by default', () => {
    const c = DEFAULT_ROLE_PERMISSIONS.CASHIER;
    expect(can(c, 'reports')).toBe(false);
    expect(can(c, 'pos', 'create')).toBe(true);
    expect(c.caps.cancelPaidOrders).toBe(false);
  });
  it('sanitises untrusted permission JSON', () => {
    const p = sanitizePermissions({ modules: { pos: ['view', 'hack'], nope: ['view'] }, caps: { viewPrices: 'yes' }, maxDiscountPercent: 500 });
    expect(p.modules.pos).toEqual(['view']);
    expect((p.modules as Record<string, unknown>).nope).toBeUndefined();
    expect(p.caps.viewPrices).toBe(false);
    expect(p.maxDiscountPercent).toBe(100);
  });
  it('fills nested setting defaults', () => {
    const s = parseSettings({ vatRate: 5 });
    expect(s.vatRate).toBe(5);
    expect(s.receipt.copies).toBe(1);
    expect(s.whatsapp.orderReady).toContain('{orderNo}');
  });
});

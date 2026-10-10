import { describe, expect, it } from 'vitest';
import {
  calcOrder,
  customerAppSettingsSchema,
  driverFee,
  earliestDelivery,
  parseAppRef,
  parseSettings,
  slotInstant,
  slotState,
} from '../src';

const app = customerAppSettingsSchema.parse({
  enabled: true,
  pickup: { enabled: true, fee: 0.5 },
  delivery: { enabled: true, fee: 0.5 },
  roundTripFee: 0.8,
  freeAbove: 6,
});

describe('customer app settings', () => {
  it('defaults to off, counter only, with three driver windows', () => {
    const s = parseSettings({}).customerApp;
    expect(s).toMatchObject({ enabled: false, counter: true, pickup: { enabled: false }, delivery: { enabled: false }, roundTripFee: null });
    expect(s.slots.map((x) => x.id)).toEqual(['morning', 'afternoon', 'evening']);
  });
  it('needs pickup and delivery when there is no counter', () => {
    expect(customerAppSettingsSchema.safeParse({ counter: false, pickup: { enabled: true } }).success).toBe(false);
  });
});

describe('driver fee', () => {
  it('charges each leg, the round trip for both, nothing at the counter or above the free amount', () => {
    expect(driverFee(app, { inbound: 'DROPOFF', outbound: 'COLLECT' }, 1)).toBe(0);
    expect(driverFee(app, { inbound: 'PICKUP', outbound: 'COLLECT' }, 1)).toBe(0.5);
    expect(driverFee(app, { inbound: 'PICKUP', outbound: 'DELIVERY' }, 1)).toBe(0.8);
    expect(driverFee(app, { inbound: 'PICKUP', outbound: 'DELIVERY' }, 6)).toBe(0);
    expect(driverFee({ ...app, roundTripFee: null }, { inbound: 'PICKUP', outbound: 'DELIVERY' }, 1)).toBe(1);
  });
  it('is part of the taxable amount, never discounted', () => {
    const r = calcOrder({
      lines: [{ unitPrice: 1, unit: 'PIECE', quantity: 2 }],
      express: false,
      expressSurchargeType: 'PERCENT',
      expressSurchargeValue: 50,
      orderDiscountType: 'PERCENT',
      orderDiscountValue: 50,
      vatRate: 10,
      pricesIncludeVat: false,
      serviceCharge: 0.8,
    });
    expect(r).toMatchObject({ orderDiscount: 1, serviceCharge: 0.8, netAmount: 1.8, vatAmount: 0.18, total: 1.98 });
    // Unchanged without one.
    expect(calcOrder({ lines: [{ unitPrice: 1, unit: 'PIECE', quantity: 1 }], express: false, expressSurchargeType: 'PERCENT', expressSurchargeValue: 0, vatRate: 10, pricesIncludeVat: false }).total).toBe(1.1);
  });
});

describe('driver windows (Bahrain time)', () => {
  const morning = { startHour: 9, endHour: 12 };
  const evening = { startHour: 16, endHour: 20 };
  it('places a window in Bahrain time', () => {
    expect(slotInstant('2026-10-10', 9).toISOString()).toBe('2026-10-10T06:00:00.000Z');
    expect(slotInstant('2026-10-10', 24).toISOString()).toBe('2026-10-10T21:00:00.000Z');
  });
  it('closes a window an hour before it ends, and limits how far ahead', () => {
    const now = new Date('2026-10-10T08:30:00Z'); // 11:30 in Bahrain
    expect(slotState('2026-10-10', morning, now)).toBe('PAST');
    expect(slotState('2026-10-10', evening, now)).toBe('OPEN');
    expect(slotState('2026-11-30', evening, now)).toBe('TOO_FAR');
  });
  it('won’t deliver before the clothes are in and cleaned', () => {
    const now = new Date('2026-10-10T05:00:00Z'); // 08:00 Bahrain
    const earliest = earliestDelivery(now, 48, { date: '2026-10-10', endHour: 12 });
    expect(earliest.toISOString()).toBe('2026-10-12T09:00:00.000Z'); // Mon 12:00 Bahrain
    expect(slotState('2026-10-12', morning, now, earliest)).toBe('TOO_EARLY');
    expect(slotState('2026-10-12', evening, now, earliest)).toBe('OPEN');
  });
});

describe('app pass', () => {
  it('reads a customer app reference', () => {
    expect(parseAppRef('a-7k2q9f')).toBe('A-7K2Q9F');
    expect(parseAppRef('A7K2Q9F')).toBe('A-7K2Q9F');
    expect(parseAppRef('O1042')).toBeNull();
  });
});

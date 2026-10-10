import { toFils, fromFils } from './money';
import type { AppSlot, CustomerAppSettings } from './settings';
import { TZ_OFFSET, addDays, bhDate } from './time';

/**
 * Pickup and delivery rules for the customer app, in Bahrain time. The API
 * validates bookings with these and the staff app displays them, so the two
 * always agree. The customer app has the same rules (lib/handover.ts there).
 */

export type Inbound = 'DROPOFF' | 'PICKUP';
export type Outbound = 'COLLECT' | 'DELIVERY';
export interface Handover {
  inbound: Inbound;
  outbound: Outbound;
}

export const usesDriver = (h: Handover) => h.inbound === 'PICKUP' || h.outbound === 'DELIVERY';

/** Whether the shop offers this combination. */
export function isHandoverOffered(a: CustomerAppSettings, h: Handover): boolean {
  const inOk = h.inbound === 'DROPOFF' ? a.counter : a.pickup.enabled;
  const outOk = h.outbound === 'COLLECT' ? a.counter : a.delivery.enabled;
  return inOk && outOk;
}

/**
 * Driver fee as the shop set it up: each leg's fee, or the round-trip price
 * for both, and nothing once the order value before VAT reaches `freeAbove`.
 */
export function driverFee(a: CustomerAppSettings, h: Handover, valueBeforeVat: number): number {
  const pickup = h.inbound === 'PICKUP';
  const delivery = h.outbound === 'DELIVERY';
  if (!pickup && !delivery) return 0;
  if (a.freeAbove !== null && toFils(valueBeforeVat) >= toFils(a.freeAbove)) return 0;
  if (pickup && delivery && a.roundTripFee !== null) return fromFils(toFils(a.roundTripFee));
  return fromFils((pickup ? toFils(a.pickup.fee) : 0) + (delivery ? toFils(a.delivery.fee) : 0));
}

/** The instant `hour` o'clock (Bahrain) on a YYYY-MM-DD day. Hour 24 is the next midnight. */
export function slotInstant(date: string, hour: number): Date {
  const day = hour >= 24 ? addDays(date, 1) : date;
  const h = String(hour % 24).padStart(2, '0');
  return new Date(`${day}T${h}:00:00.000${TZ_OFFSET}`);
}

/** Windows close an hour before they end. */
export function isSlotPast(date: string, slot: Pick<AppSlot, 'endHour'>, now: Date = new Date()): boolean {
  return now.getTime() >= slotInstant(date, slot.endHour).getTime() - 3_600_000;
}

/** The earliest a delivery may start: clothes in hand (now, or the end of the pickup window) plus turnaround. */
export function earliestDelivery(now: Date, turnaroundHours: number, pickup?: { date: string; endHour: number }): Date {
  const inHand = pickup ? slotInstant(pickup.date, pickup.endHour) : now;
  return new Date(Math.max(inHand.getTime(), now.getTime()) + turnaroundHours * 3_600_000);
}

export type SlotState = 'OPEN' | 'PAST' | 'TOO_EARLY' | 'TOO_FAR';

/** How far ahead customers can book. */
export const BOOKING_DAYS = 14;

export function slotState(date: string, slot: Pick<AppSlot, 'startHour' | 'endHour'>, now: Date, earliest?: Date): SlotState {
  if (date > addDays(bhDate(now), BOOKING_DAYS)) return 'TOO_FAR';
  if (isSlotPast(date, slot, now)) return 'PAST';
  if (earliest && slotInstant(date, slot.startHour).getTime() < earliest.getTime()) return 'TOO_EARLY';
  return 'OPEN';
}

import { addDays, bhDate } from '@laundry/shared';
import { AppError } from './errors';
import type { TenantDb, TenantTx } from './tenant-db';

type Q = TenantDb | TenantTx;

/**
 * The business date new money movements are booked on: today (Bahrain),
 * or the next open day if today's cash has already been closed.
 */
export async function currentBusinessDate(db: Q, now = new Date()): Promise<string> {
  let d = bhDate(now);
  const closed = await db.cashClosing.findMany({ where: { businessDate: { gte: d } }, select: { businessDate: true } });
  const set = new Set(closed.map((c) => c.businessDate));
  while (set.has(d)) d = addDays(d, 1);
  return d;
}

/** Closed days are locked: no money movements may be added or changed on them. */
export async function assertDayOpen(db: Q, date: string): Promise<void> {
  const c = await db.cashClosing.findFirst({ where: { businessDate: date }, select: { id: true } });
  if (c) throw new AppError(409, 'DAY_CLOSED', `The day ${date} has been closed and is locked`);
}

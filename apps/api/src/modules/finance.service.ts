import { addDays, addMonths, bhDate, fromFils, sumBhd, toFils } from '@laundry/shared';
import { currentBusinessDate } from '../lib/business-date';
import { num } from '../lib/prisma';
import type { Ctx } from '../lib/service-context';
import type { TenantDb, TenantTx } from '../lib/tenant-db';

type Q = TenantDb | TenantTx;

export interface CashSummary {
  businessDate: string;
  closed: boolean;
  openingFloat: number;
  cashSales: number;
  cashTopups: number;
  cashRefunds: number;
  cashExpenses: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  reason: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  otherMethods: { method: string; amount: number }[];
}

/** Money movements of one business day, for the daily cash closing. */
export async function cashSummary(db: Q, ctx: Ctx, date: string, openingFloat?: number): Promise<CashSummary> {
  const closing = await db.cashClosing.findFirst({ where: { businessDate: date } });
  if (closing) {
    return {
      businessDate: date,
      closed: true,
      openingFloat: num(closing.openingFloat),
      cashSales: num(closing.cashSales),
      cashTopups: num(closing.cashTopups),
      cashRefunds: num(closing.cashRefunds),
      cashExpenses: num(closing.cashExpenses),
      expectedCash: num(closing.expectedCash),
      countedCash: num(closing.countedCash),
      difference: num(closing.difference),
      reason: closing.reason,
      closedByName: closing.closedByName,
      closedAt: closing.closedAt,
      otherMethods: await otherMethods(db, date),
    };
  }
  const [byKind, expenses] = await Promise.all([
    db.payment.groupBy({ by: ['kind'], where: { businessDate: date, method: 'CASH' }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { date, method: 'CASH' }, _sum: { amount: true } }),
  ]);
  const k = (kinds: string[]) => sumBhd(byKind.filter((r) => kinds.includes(r.kind)).map((r) => num(r._sum.amount)));
  const cashSales = k(['ORDER']);
  const cashTopups = k(['TOPUP', 'PACKAGE_SALE']);
  const cashRefunds = -k(['REFUND', 'WALLET_REFUND']);
  const cashExpenses = num(expenses._sum.amount);
  const float = openingFloat ?? ctx.settings.defaultOpeningFloat;
  const expectedCash = fromFils(toFils(float) + toFils(cashSales) + toFils(cashTopups) - toFils(cashRefunds) - toFils(cashExpenses));
  return {
    businessDate: date,
    closed: false,
    openingFloat: float,
    cashSales,
    cashTopups,
    cashRefunds,
    cashExpenses,
    expectedCash,
    countedCash: null,
    difference: null,
    reason: null,
    closedByName: null,
    closedAt: null,
    otherMethods: await otherMethods(db, date),
  };
}

async function otherMethods(db: Q, date: string) {
  const rows = await db.payment.groupBy({
    by: ['method'],
    where: { businessDate: date, method: { notIn: ['CASH', 'PACKAGE'] }, kind: { not: 'PACKAGE_REDEMPTION' } },
    _sum: { amount: true },
  });
  return rows.map((r) => ({ method: r.method, amount: num(r._sum.amount) })).filter((r) => r.amount !== 0);
}

/** Next occurrence of a recurring expense, keeping the anchor day in shorter months. */
export function advanceRecurring(date: string, freq: 'WEEKLY' | 'MONTHLY' | 'YEARLY', anchorDay: number): string {
  if (freq === 'WEEKLY') return addDays(date, 7);
  const months = freq === 'MONTHLY' ? 1 : 12;
  const month = addMonths(date.slice(0, 7), months);
  const lastDay = Number(addDays(`${addMonths(month, 1)}-01`, -1).slice(8, 10));
  return `${month}-${String(Math.min(anchorDay, lastDay)).padStart(2, '0')}`;
}

/** Create expenses for recurring templates that are due (e.g. monthly rent). */
export async function generateRecurringExpenses(db: TenantDb, ctx: Ctx, today = bhDate()): Promise<number> {
  const due = await db.recurringExpense.findMany({ where: { isActive: true, nextDate: { lte: today } } });
  let created = 0;
  for (const r of due) {
    await db.$transaction(async (tx) => {
      let next = r.nextDate;
      const anchor = r.anchorDay;
      let guard = 0;
      while (next <= today && (!r.endDate || next <= r.endDate) && guard++ < 60) {
        const closed = await tx.cashClosing.findFirst({ where: { businessDate: next } });
        const date = closed ? await currentBusinessDate(tx) : next;
        await tx.expense.create({
          data: {
            tenantId: ctx.tenantId,
            categoryId: r.categoryId,
            amount: r.amount,
            date,
            method: r.method,
            vendor: r.vendor,
            notes: r.notes ? `${r.notes} (recurring)` : 'Recurring expense',
            recurringId: r.id,
            createdByName: 'System',
          },
        });
        created++;
        next = advanceRecurring(next, r.frequency, anchor);
      }
      const ended = !!r.endDate && next > r.endDate;
      await tx.recurringExpense.update({ where: { id: r.id }, data: { nextDate: next, isActive: !ended } });
    });
  }
  return created;
}

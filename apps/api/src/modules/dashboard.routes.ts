import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { addDays, bhDate, can, monthRange, startOfDay, subBhd } from '@laundry/shared';
import { currentBusinessDate } from '../lib/business-date';
import { perm, requireTenant } from '../lib/context';
import { num } from '../lib/prisma';
import { ctxOf } from '../lib/service-context';
import { cashSummary } from './finance.service';
import { expiryAlerts } from './staff.routes';
import { computeAlerts } from './tracking.routes';

/** Owner dashboard: today at a glance and month-to-date performance. */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: perm('dashboard', 'view') }, async (req) => {
    const a = requireTenant(req);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const tenantId = a.tenant.id;
    const today = bhDate();
    const bizDate = await currentBusinessDate(db);
    const month = today.slice(0, 7);
    const { from } = monthRange(month);
    const showFinance = can(a.perms, 'finance_reports', 'view');

    const [todayOrders, todayRevenue, todayExpenses, readyNotCollected, cash, alerts, docAlerts] = await Promise.all([
      db.order.aggregate({
        where: { businessDate: today, orderNo: { not: null }, status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { pieceCount: true, total: true },
      }),
      db.payment.aggregate({ where: { businessDate: today, kind: { in: ['ORDER', 'REFUND', 'PACKAGE_REDEMPTION'] } }, _sum: { revenueAmount: true, vatPortion: true, amount: true } }),
      db.expense.aggregate({ where: { date: today }, _sum: { amount: true } }),
      db.order.count({ where: { status: 'READY' } }),
      cashSummary(db, ctx, bizDate),
      computeAlerts(app, req),
      can(a.perms, 'staff', 'view') ? expiryAlerts(app, req) : Promise.resolve([]),
    ]);

    // Month to date — daily trend of recognised revenue (net of VAT) and expenses.
    const [rev, exp, topItems, topServices, newCustomers, mtdOrders] = await Promise.all([
      app.prisma.$queryRaw<{ day: string; revenue: Prisma.Decimal; vat: Prisma.Decimal }[]>`
        SELECT "businessDate" AS day, COALESCE(SUM("revenueAmount"), 0) AS revenue, COALESCE(SUM("vatPortion"), 0) AS vat
        FROM "Payment" WHERE "tenantId" = ${tenantId} AND "businessDate" >= ${from} AND "businessDate" <= ${today}
          AND kind IN ('ORDER','REFUND','PACKAGE_REDEMPTION')
        GROUP BY 1`,
      app.prisma.$queryRaw<{ day: string; amount: Prisma.Decimal }[]>`
        SELECT "date" AS day, COALESCE(SUM(amount), 0) AS amount FROM "Expense"
        WHERE "tenantId" = ${tenantId} AND "date" >= ${from} AND "date" <= ${today} GROUP BY 1`,
      db.orderItem.groupBy({
        by: ['itemName'],
        where: { order: { businessDate: { gte: from, lte: today }, orderNo: { not: null }, status: { not: 'CANCELLED' } } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 6,
      }),
      db.orderItem.groupBy({
        by: ['serviceName'],
        where: { order: { businessDate: { gte: from, lte: today }, orderNo: { not: null }, status: { not: 'CANCELLED' } } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 6,
      }),
      db.customer.count({ where: { createdAt: { gte: startOfDay(from) } } }),
      db.order.aggregate({ where: { businessDate: { gte: from, lte: today }, orderNo: { not: null }, status: { not: 'CANCELLED' } }, _count: true, _sum: { total: true } }),
    ]);

    const trend: { date: string; revenue: number; expenses: number; profit: number }[] = [];
    let revTotal = 0;
    let expTotal = 0;
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const r = rev.find((x) => x.day === d);
      const e = exp.find((x) => x.day === d);
      const revenue = subBhd(num(r?.revenue), num(r?.vat));
      const expenses = num(e?.amount);
      revTotal += Math.round(revenue * 1000);
      expTotal += Math.round(expenses * 1000);
      trend.push({ date: d, revenue, expenses, profit: subBhd(revenue, expenses) });
    }

    const todayNetRevenue = subBhd(num(todayRevenue._sum.revenueAmount), num(todayRevenue._sum.vatPortion));
    return {
      date: today,
      businessDate: bizDate,
      showFinance,
      today: {
        orders: todayOrders._count,
        pieces: todayOrders._sum.pieceCount ?? 0,
        sales: num(todayOrders._sum.total),
        revenue: showFinance ? todayNetRevenue : null,
        cashInDrawer: cash.closed ? null : cash.expectedCash,
        cashClosed: cash.closed,
        expenses: showFinance ? num(todayExpenses._sum.amount) : null,
        readyNotCollected,
        overdue: alerts.counts.overdue,
        express: alerts.counts.express,
        uncollected: alerts.counts.uncollected,
      },
      month: {
        month,
        orders: mtdOrders._count,
        sales: num(mtdOrders._sum.total),
        revenue: showFinance ? revTotal / 1000 : null,
        expenses: showFinance ? expTotal / 1000 : null,
        profit: showFinance ? (revTotal - expTotal) / 1000 : null,
        newCustomers,
        trend: showFinance ? trend : trend.map((t) => ({ date: t.date, revenue: null, expenses: null, profit: null })),
        topItems: topItems.map((r) => ({ name: r.itemName, pieces: r._sum.quantity ?? 0, amount: num(r._sum.lineTotal) })),
        topServices: topServices.map((r) => ({ name: r.serviceName, pieces: r._sum.quantity ?? 0, amount: num(r._sum.lineTotal) })),
      },
      alerts: {
        overdue: alerts.overdue.slice(0, 8),
        uncollected: alerts.uncollected.slice(0, 8),
        express: alerts.express.slice(0, 8),
        documents: docAlerts.slice(0, 10),
        uncollectedDays: alerts.uncollectedDays,
      },
    };
  });
}

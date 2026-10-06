import { Prisma, type PrismaClient } from '@prisma/client';
import { addBhd, endOfDay, formatMobile, fromFils, startOfDay, subBhd, sumBhd, toFils, type Module } from '@laundry/shared';
import type { Table } from '../lib/excel';
import { num } from '../lib/prisma';
import { t } from '../lib/t';

export interface ReportParams {
  tenantId: string;
  from: string;
  to: string;
  showPhone: boolean;
}

export interface ReportResult {
  title: string;
  subtitle: string;
  tables: Table[];
  /** Headline figures shown above the table in the UI. */
  kpis?: { label: string; value: number; type: 'money' | 'number' }[];
}

export interface ReportDef {
  key: string;
  title: string;
  module: Module;
  group: 'sales' | 'finance' | 'staff';
  run: (prisma: PrismaClient, p: ReportParams) => Promise<ReportResult>;
}

const period = (p: ReportParams) => t('rpt.period', { from: p.from, to: p.to });
const range = (p: ReportParams) => ({ gte: startOfDay(p.from), lt: endOfDay(p.to) });
const dateRange = (p: ReportParams) => ({ gte: p.from, lte: p.to });
const sumCol = (rows: Record<string, unknown>[], key: string) => sumBhd(rows.map((r) => Number(r[key] ?? 0)));
const countCol = (rows: Record<string, unknown>[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

// ───────────────────────────── Finance ─────────────────────────────

/** Recognised revenue (cash basis): order payments, paid part of prepaid balance used, package pieces used — minus refunds. */
async function revenueByMonth(prisma: PrismaClient, p: ReportParams) {
  return prisma.$queryRaw<{ month: string; revenue: Prisma.Decimal; vat: Prisma.Decimal; bonus: Prisma.Decimal }[]>`
    SELECT substring("businessDate", 1, 7) AS month,
           COALESCE(SUM("revenueAmount"), 0) AS revenue,
           COALESCE(SUM("vatPortion"), 0) AS vat,
           COALESCE(SUM("walletBonusPortion"), 0) AS bonus
    FROM "Payment"
    WHERE "tenantId" = ${p.tenantId} AND "businessDate" >= ${p.from} AND "businessDate" <= ${p.to}
      AND kind IN ('ORDER', 'REFUND', 'PACKAGE_REDEMPTION')
    GROUP BY 1 ORDER BY 1`;
}

async function expensesByMonth(prisma: PrismaClient, p: ReportParams) {
  return prisma.$queryRaw<{ month: string; amount: Prisma.Decimal }[]>`
    SELECT substring("date", 1, 7) AS month, COALESCE(SUM(amount), 0) AS amount
    FROM "Expense" WHERE "tenantId" = ${p.tenantId} AND "date" >= ${p.from} AND "date" <= ${p.to}
    GROUP BY 1 ORDER BY 1`;
}

export async function profitLoss(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const [rev, exp, cats] = await Promise.all([
    revenueByMonth(prisma, p),
    expensesByMonth(prisma, p),
    prisma.$queryRaw<{ category: string; amount: Prisma.Decimal }[]>`
      SELECT c.name AS category, COALESCE(SUM(e.amount), 0) AS amount
      FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
      WHERE e."tenantId" = ${p.tenantId} AND e."date" >= ${p.from} AND e."date" <= ${p.to}
      GROUP BY c.name ORDER BY 2 DESC`,
  ]);
  const months = [...new Set([...rev.map((r) => r.month), ...exp.map((e) => e.month)])].sort();
  const rows = months.map((month) => {
    const r = rev.find((x) => x.month === month);
    const e = exp.find((x) => x.month === month);
    const gross = num(r?.revenue);
    const vat = num(r?.vat);
    const net = subBhd(gross, vat);
    const expenses = num(e?.amount);
    return { month, gross, vat, net, expenses, profit: subBhd(net, expenses), bonus: num(r?.bonus) };
  });
  const totals = {
    month: t('rpt.total'),
    gross: sumCol(rows, 'gross'),
    vat: sumCol(rows, 'vat'),
    net: sumCol(rows, 'net'),
    expenses: sumCol(rows, 'expenses'),
    profit: sumCol(rows, 'profit'),
    bonus: sumCol(rows, 'bonus'),
  };
  return {
    title: t('rpt.profit_loss'),
    subtitle: period(p),
    kpis: [
      { label: t('rpt.net_revenue'), value: totals.net, type: 'money' },
      { label: t('rpt.expenses'), value: totals.expenses, type: 'money' },
      { label: t('rpt.net_profit'), value: totals.profit, type: 'money' },
    ],
    tables: [
      {
        name: t('rpt.p_l_by_month'),
        title: t('rpt.profit_loss_by_month'),
        subtitle: t('rpt.revenue_is_recognised_when_orders_are_pa'),
        columns: [
          { key: 'month', header: t('rpt.month') },
          { key: 'gross', header: t('rpt.revenue_incl_vat'), type: 'money' },
          { key: 'vat', header: t('rpt.vat'), type: 'money' },
          { key: 'net', header: t('rpt.net_revenue'), type: 'money' },
          { key: 'expenses', header: t('rpt.expenses'), type: 'money' },
          { key: 'profit', header: t('rpt.net_profit'), type: 'money' },
          { key: 'bonus', header: t('rpt.bonus_credit_used_memo'), type: 'money' },
        ],
        rows,
        totals,
      },
      {
        name: t('rpt.expenses_by_category'),
        title: t('rpt.expenses_by_category'),
        columns: [
          { key: 'category', header: t('rpt.category') },
          { key: 'amount', header: t('rpt.amount'), type: 'money' },
        ],
        rows: cats.map((c) => ({ category: c.category, amount: num(c.amount) })),
        totals: { category: t('rpt.total'), amount: sumBhd(cats.map((c) => num(c.amount))) },
      },
    ],
  };
}

export async function expensesByCategory(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const rows = await prisma.$queryRaw<{ category: string; count: bigint; amount: Prisma.Decimal }[]>`
    SELECT c.name AS category, COUNT(*) AS count, COALESCE(SUM(e.amount), 0) AS amount
    FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
    WHERE e."tenantId" = ${p.tenantId} AND e."date" >= ${p.from} AND e."date" <= ${p.to}
    GROUP BY c.name ORDER BY 3 DESC`;
  const total = sumBhd(rows.map((r) => num(r.amount)));
  const data = rows.map((r) => ({
    category: r.category,
    count: Number(r.count),
    amount: num(r.amount),
    share: total ? Math.round((num(r.amount) / total) * 10000) / 100 : 0,
  }));
  const details = await prisma.expense.findMany({
    where: { tenantId: p.tenantId, date: dateRange(p) },
    include: { category: true },
    orderBy: { date: 'asc' },
  });
  return {
    title: t('rpt.expenses_by_category'),
    subtitle: period(p),
    kpis: [{ label: t('rpt.total_expenses'), value: total, type: 'money' }],
    tables: [
      {
        name: t('rpt.by_category'),
        columns: [
          { key: 'category', header: t('rpt.category') },
          { key: 'count', header: t('rpt.entries'), type: 'number' },
          { key: 'amount', header: t('rpt.amount'), type: 'money' },
          { key: 'share', header: t('rpt.share'), type: 'percent' },
        ],
        rows: data,
        totals: { category: t('rpt.total'), count: countCol(data, 'count'), amount: total, share: 100 },
      },
      {
        name: t('rpt.expense_details'),
        title: t('rpt.expense_details'),
        columns: [
          { key: 'date', header: t('rpt.date') },
          { key: 'category', header: t('rpt.category') },
          { key: 'vendor', header: t('rpt.vendor') },
          { key: 'method', header: t('rpt.method') },
          { key: 'notes', header: t('rpt.notes'), width: 30 },
          { key: 'amount', header: t('rpt.amount'), type: 'money' },
        ],
        rows: details.map((e) => ({ date: e.date, category: e.category.name, vendor: e.vendor, method: t(`paymentMethod.${e.method}`), notes: e.notes, amount: num(e.amount) })),
        totals: { date: t('rpt.total'), amount: total },
      },
    ],
  };
}

/** Output VAT on tax invoices issued in the period (non-cancelled orders). */
export async function vatReport(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const rows = await prisma.$queryRaw<{ month: string; invoices: bigint; taxable: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal }[]>`
    SELECT substring("businessDate", 1, 7) AS month, COUNT(*) AS invoices,
           COALESCE(SUM("netAmount"), 0) AS taxable, COALESCE(SUM("vatAmount"), 0) AS vat, COALESCE(SUM(total), 0) AS total
    FROM "Order"
    WHERE "tenantId" = ${p.tenantId} AND "orderNo" IS NOT NULL AND status <> 'CANCELLED'
      AND "businessDate" >= ${p.from} AND "businessDate" <= ${p.to}
    GROUP BY 1 ORDER BY 1`;
  const pkg = await prisma.$queryRaw<{ month: string; revenue: Prisma.Decimal; vat: Prisma.Decimal }[]>`
    SELECT substring("businessDate", 1, 7) AS month, COALESCE(SUM("revenueAmount"), 0) AS revenue, COALESCE(SUM("vatPortion"), 0) AS vat
    FROM "Payment" WHERE "tenantId" = ${p.tenantId} AND kind = 'PACKAGE_REDEMPTION' AND "businessDate" >= ${p.from} AND "businessDate" <= ${p.to}
    GROUP BY 1 ORDER BY 1`;
  const data = rows.map((r) => {
    const pk = pkg.find((x) => x.month === r.month);
    const pkgVat = num(pk?.vat);
    const pkgTaxable = subBhd(num(pk?.revenue), pkgVat);
    return {
      month: r.month,
      invoices: Number(r.invoices),
      taxable: addBhd(num(r.taxable), pkgTaxable),
      vat: addBhd(num(r.vat), pkgVat),
      total: addBhd(num(r.total), num(pk?.revenue)),
      packageVat: pkgVat,
    };
  });
  for (const pk of pkg) {
    if (!data.find((d) => d.month === pk.month)) {
      const v = num(pk.vat);
      data.push({ month: pk.month, invoices: 0, taxable: subBhd(num(pk.revenue), v), vat: v, total: num(pk.revenue), packageVat: v });
    }
  }
  data.sort((a, b) => a.month.localeCompare(b.month));
  const totals = { month: t('rpt.total'), invoices: countCol(data, 'invoices'), taxable: sumCol(data, 'taxable'), vat: sumCol(data, 'vat'), total: sumCol(data, 'total'), packageVat: sumCol(data, 'packageVat') };
  return {
    title: t('rpt.vat_report'),
    subtitle: `${t('rpt.output_vat')} · ${period(p)}`,
    kpis: [
      { label: t('rpt.taxable_sales'), value: totals.taxable, type: 'money' },
      { label: t('rpt.output_vat'), value: totals.vat, type: 'money' },
    ],
    tables: [
      {
        name: t('rpt.output_vat'),
        subtitle: t('rpt.tax_invoices_issued_in_the_period_cancel'),
        columns: [
          { key: 'month', header: t('rpt.month') },
          { key: 'invoices', header: t('rpt.invoices'), type: 'number' },
          { key: 'taxable', header: t('rpt.taxable_amount'), type: 'money' },
          { key: 'vat', header: t('rpt.output_vat'), type: 'money' },
          { key: 'total', header: t('rpt.total_incl_vat'), type: 'money' },
          { key: 'packageVat', header: t('rpt.of_which_package_vat'), type: 'money' },
        ],
        rows: data,
        totals,
      },
    ],
  };
}

/** Prepaid balances held for customers (a liability). */
export async function customerBalances(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const customers = await prisma.customer.findMany({
    where: { tenantId: p.tenantId, OR: [{ walletPaid: { not: 0 } }, { walletBonus: { not: 0 } }] },
    orderBy: { name: 'asc' },
  });
  const pkgs = await prisma.customerPackage.findMany({
    where: { tenantId: p.tenantId, kind: 'ITEMS', status: 'ACTIVE', remainingItems: { gt: 0 } },
    include: { customer: true },
  });
  const rows = customers.map((c) => ({
    name: c.name,
    mobile: p.showPhone ? formatMobile(c.mobile) : '',
    paid: num(c.walletPaid),
    bonus: num(c.walletBonus),
    total: addBhd(num(c.walletPaid), num(c.walletBonus)),
  }));
  const pkgRows = pkgs.map((k) => {
    const unearned = fromFils(Math.round((toFils(num(k.pricePaid)) * k.remainingItems) / Math.max(1, k.totalItems)));
    return { name: k.customer.name, package: k.name, remaining: k.remainingItems, total: k.totalItems, unearned, expires: k.expiresAt?.toISOString().slice(0, 10) ?? '' };
  });
  const liability = sumCol(rows, 'paid');
  const pkgLiability = sumCol(pkgRows, 'unearned');
  return {
    title: t('rpt.customer_balances'),
    subtitle: t('rpt.prepaid_balances_and_unused_packages_as_'),
    kpis: [
      { label: t('rpt.paid_credit_liability'), value: liability, type: 'money' },
      { label: t('rpt.bonus_credit'), value: sumCol(rows, 'bonus'), type: 'money' },
      { label: t('rpt.unused_packages'), value: pkgLiability, type: 'money' },
    ],
    tables: [
      {
        name: t('rpt.prepaid_balances'),
        subtitle: t('rpt.paid_credit_is_customer_money_held_liabi'),
        columns: [
          { key: 'name', header: t('rpt.customer'), width: 28 },
          ...(p.showPhone ? [{ key: 'mobile', header: t('rpt.mobile'), width: 16 }] : []),
          { key: 'paid', header: t('rpt.paid_credit'), type: 'money' as const },
          { key: 'bonus', header: t('rpt.bonus_credit'), type: 'money' as const },
          { key: 'total', header: t('rpt.total_balance'), type: 'money' as const },
        ],
        rows,
        totals: { name: t('rpt.total'), paid: liability, bonus: sumCol(rows, 'bonus'), total: sumCol(rows, 'total') },
      },
      {
        name: t('rpt.unused_packages'),
        title: t('rpt.unused_item_packages'),
        columns: [
          { key: 'name', header: t('rpt.customer'), width: 28 },
          { key: 'package', header: t('rpt.package'), width: 24 },
          { key: 'remaining', header: t('rpt.items_left'), type: 'number' },
          { key: 'total', header: t('rpt.of'), type: 'number' },
          { key: 'unearned', header: t('rpt.unused_value'), type: 'money' },
          { key: 'expires', header: t('rpt.expires') },
        ],
        rows: pkgRows,
        totals: { name: t('rpt.total'), unearned: pkgLiability },
      },
    ],
  };
}

// ───────────────────────────── Sales ─────────────────────────────

export async function salesByDay(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const orders = await prisma.$queryRaw<
    { day: string; orders: bigint; pieces: bigint; gross: Prisma.Decimal; discount: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal }[]
  >`
    SELECT "businessDate" AS day, COUNT(*) AS orders, COALESCE(SUM("pieceCount"), 0) AS pieces,
           COALESCE(SUM(subtotal + "expressSurcharge"), 0) AS gross, COALESCE(SUM("discountTotal"), 0) AS discount,
           COALESCE(SUM("vatAmount"), 0) AS vat, COALESCE(SUM(total), 0) AS total
    FROM "Order"
    WHERE "tenantId" = ${p.tenantId} AND "orderNo" IS NOT NULL AND status <> 'CANCELLED'
      AND "businessDate" >= ${p.from} AND "businessDate" <= ${p.to}
    GROUP BY 1 ORDER BY 1`;
  const collected = await prisma.$queryRaw<{ day: string; collected: Prisma.Decimal; revenue: Prisma.Decimal }[]>`
    SELECT "businessDate" AS day, COALESCE(SUM(amount) FILTER (WHERE kind IN ('ORDER','REFUND')), 0) AS collected,
           COALESCE(SUM("revenueAmount"), 0) AS revenue
    FROM "Payment" WHERE "tenantId" = ${p.tenantId} AND "businessDate" >= ${p.from} AND "businessDate" <= ${p.to}
      AND kind IN ('ORDER','REFUND','PACKAGE_REDEMPTION')
    GROUP BY 1`;
  const days = [...new Set([...orders.map((o) => o.day), ...collected.map((c) => c.day)])].sort();
  const rows = days.map((day) => {
    const o = orders.find((x) => x.day === day);
    const c = collected.find((x) => x.day === day);
    return {
      day,
      orders: Number(o?.orders ?? 0),
      pieces: Number(o?.pieces ?? 0),
      gross: num(o?.gross),
      discount: num(o?.discount),
      vat: num(o?.vat),
      total: num(o?.total),
      collected: num(c?.collected),
      revenue: num(c?.revenue),
    };
  });
  const totals = {
    day: t('rpt.total'),
    orders: countCol(rows, 'orders'),
    pieces: countCol(rows, 'pieces'),
    gross: sumCol(rows, 'gross'),
    discount: sumCol(rows, 'discount'),
    vat: sumCol(rows, 'vat'),
    total: sumCol(rows, 'total'),
    collected: sumCol(rows, 'collected'),
    revenue: sumCol(rows, 'revenue'),
  };
  return {
    title: t('rpt.sales_by_day'),
    subtitle: period(p),
    kpis: [
      { label: t('rpt.orders'), value: totals.orders, type: 'number' },
      { label: t('rpt.sales_incl_vat'), value: totals.total, type: 'money' },
      { label: t('rpt.collected'), value: totals.collected, type: 'money' },
    ],
    tables: [
      {
        name: t('rpt.sales_by_day'),
        columns: [
          { key: 'day', header: t('rpt.date') },
          { key: 'orders', header: t('rpt.orders'), type: 'number' },
          { key: 'pieces', header: t('rpt.pieces'), type: 'number' },
          { key: 'gross', header: t('rpt.gross'), type: 'money' },
          { key: 'discount', header: t('rpt.discounts'), type: 'money' },
          { key: 'vat', header: t('rpt.vat'), type: 'money' },
          { key: 'total', header: t('rpt.sales_incl_vat'), type: 'money' },
          { key: 'collected', header: t('rpt.collected'), type: 'money' },
          { key: 'revenue', header: t('rpt.recognised_revenue'), type: 'money' },
        ],
        rows,
        totals,
      },
    ],
  };
}

async function salesByLine(prisma: PrismaClient, p: ReportParams, field: 'itemName' | 'serviceName', title: string): Promise<ReportResult> {
  const rows = await prisma.orderItem.groupBy({
    by: [field],
    where: { tenantId: p.tenantId, order: { orderNo: { not: null }, status: { not: 'CANCELLED' }, businessDate: dateRange(p) } },
    _sum: { quantity: true, grossAmount: true, discountAmount: true, lineTotal: true },
    _count: true,
  });
  const data = rows
    .map((r) => ({
      name: r[field],
      lines: r._count,
      pieces: r._sum.quantity ?? 0,
      gross: num(r._sum.grossAmount),
      discount: num(r._sum.discountAmount),
      net: num(r._sum.lineTotal),
    }))
    .sort((a, b) => b.net - a.net);
  const total = sumCol(data, 'net');
  for (const d of data) Object.assign(d, { share: total ? Math.round((d.net / total) * 10000) / 100 : 0 });
  return {
    title,
    subtitle: `${period(p)} · ${t('rpt.line_amounts_note')}`,
    tables: [
      {
        name: title,
        columns: [
          { key: 'name', header: field === 'itemName' ? t('rpt.item') : t('rpt.service'), width: 26 },
          { key: 'pieces', header: t('rpt.pieces'), type: 'number' },
          { key: 'gross', header: t('rpt.gross'), type: 'money' },
          { key: 'discount', header: t('rpt.line_discounts'), type: 'money' },
          { key: 'net', header: t('rpt.net'), type: 'money' },
          { key: 'share', header: t('rpt.share'), type: 'percent' },
        ],
        rows: data,
        totals: { name: t('rpt.total'), pieces: countCol(data, 'pieces'), gross: sumCol(data, 'gross'), discount: sumCol(data, 'discount'), net: total, share: 100 },
      },
    ],
  };
}

export async function salesByPaymentMethod(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const rows = await prisma.payment.groupBy({
    by: ['kind', 'method'],
    where: { tenantId: p.tenantId, businessDate: dateRange(p), kind: { not: 'PACKAGE_REDEMPTION' } },
    _sum: { amount: true, revenueAmount: true, walletBonusPortion: true },
    _count: true,
  });
  const kindLabel: Record<string, string> = {
    ORDER: t('rpt.order_payments'),
    REFUND: t('rpt.order_refunds'),
    TOPUP: t('rpt.balance_top_ups'),
    PACKAGE_SALE: t('rpt.package_sales'),
    WALLET_REFUND: t('rpt.balance_refunds'),
  };
  const data = rows
    .map((r) => ({
      kind: kindLabel[r.kind] ?? r.kind,
      method: t(`paymentMethod.${r.method}`),
      count: r._count,
      amount: num(r._sum.amount),
      revenue: num(r._sum.revenueAmount),
      bonus: num(r._sum.walletBonusPortion),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.amount - a.amount);
  const methodTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.method === 'WALLET') continue; // wallet use is not new money
    methodTotals.set(r.method, addBhd(methodTotals.get(r.method) ?? 0, num(r._sum.amount)));
  }
  const money = [...methodTotals.entries()].map(([m, amount]) => ({ method: t(`paymentMethod.${m}`), amount }));
  return {
    title: t('rpt.sales_by_payment_method'),
    subtitle: period(p),
    kpis: money.map((m) => ({ label: m.method, value: m.amount, type: 'money' as const })),
    tables: [
      {
        name: t('rpt.money_received_by_method'),
        columns: [
          { key: 'method', header: t('rpt.method') },
          { key: 'amount', header: t('rpt.net_received'), type: 'money' },
        ],
        rows: money,
        totals: { method: t('rpt.total'), amount: sumCol(money, 'amount') },
      },
      {
        name: t('rpt.details'),
        title: t('rpt.by_type_and_method'),
        columns: [
          { key: 'kind', header: t('rpt.type'), width: 20 },
          { key: 'method', header: t('rpt.method') },
          { key: 'count', header: t('rpt.count'), type: 'number' },
          { key: 'amount', header: t('rpt.amount'), type: 'money' },
          { key: 'revenue', header: t('rpt.recognised_revenue'), type: 'money' },
          { key: 'bonus', header: t('rpt.bonus_credit_used'), type: 'money' },
        ],
        rows: data,
      },
    ],
  };
}

export async function salesByCashier(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const [orders, payments] = await Promise.all([
    prisma.order.groupBy({
      by: ['createdByName'],
      where: { tenantId: p.tenantId, orderNo: { not: null }, status: { not: 'CANCELLED' }, businessDate: dateRange(p) },
      _count: true,
      _sum: { pieceCount: true, total: true, discountTotal: true },
    }),
    prisma.payment.groupBy({
      by: ['createdByName', 'method'],
      where: { tenantId: p.tenantId, businessDate: dateRange(p), kind: { in: ['ORDER', 'TOPUP', 'PACKAGE_SALE', 'REFUND', 'WALLET_REFUND'] }, method: { not: 'WALLET' } },
      _sum: { amount: true },
    }),
  ]);
  const names = [...new Set([...orders.map((o) => o.createdByName ?? '—'), ...payments.map((x) => x.createdByName ?? '—')])];
  const rows = names.map((name) => {
    const o = orders.find((x) => (x.createdByName ?? '—') === name);
    const pays = payments.filter((x) => (x.createdByName ?? '—') === name);
    const m = (method: string) => sumBhd(pays.filter((x) => x.method === method).map((x) => num(x._sum.amount)));
    return {
      name,
      orders: o?._count ?? 0,
      pieces: o?._sum.pieceCount ?? 0,
      sales: num(o?._sum.total),
      discounts: num(o?._sum.discountTotal),
      cash: m('CASH'),
      card: m('CARD'),
      benefit: m('BENEFIT_PAY'),
      bank: m('BANK_TRANSFER'),
    };
  });
  return {
    title: t('rpt.sales_by_cashier'),
    subtitle: period(p),
    tables: [
      {
        name: t('rpt.by_cashier'),
        columns: [
          { key: 'name', header: t('rpt.cashier'), width: 22 },
          { key: 'orders', header: t('rpt.orders'), type: 'number' },
          { key: 'pieces', header: t('rpt.pieces'), type: 'number' },
          { key: 'sales', header: t('rpt.sales_incl_vat'), type: 'money' },
          { key: 'discounts', header: t('rpt.discounts_given'), type: 'money' },
          { key: 'cash', header: t('rpt.cash_collected'), type: 'money' },
          { key: 'card', header: t('rpt.card'), type: 'money' },
          { key: 'benefit', header: t('rpt.benefitpay'), type: 'money' },
          { key: 'bank', header: t('rpt.bank_transfer'), type: 'money' },
        ],
        rows,
        totals: {
          name: t('rpt.total'),
          orders: countCol(rows, 'orders'),
          pieces: countCol(rows, 'pieces'),
          sales: sumCol(rows, 'sales'),
          discounts: sumCol(rows, 'discounts'),
          cash: sumCol(rows, 'cash'),
          card: sumCol(rows, 'card'),
          benefit: sumCol(rows, 'benefit'),
          bank: sumCol(rows, 'bank'),
        },
      },
    ],
  };
}

/** Outstanding credit-account balances and unpaid orders (as of now). */
export async function outstanding(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const orders = await prisma.order.findMany({
    where: { tenantId: p.tenantId, orderNo: { not: null }, status: { notIn: ['CANCELLED', 'DRAFT'] }, balanceDue: { gt: 0 } },
    include: { customer: true },
    orderBy: { createdAt: 'asc' },
  });
  const now = Date.now();
  const unpaid = orders.map((o) => ({
    orderNo: o.orderNo,
    date: o.businessDate,
    customer: o.customer?.name ?? t('rpt.walk_in'),
    mobile: p.showPhone && o.customer ? formatMobile(o.customer.mobile) : '',
    status: o.status,
    type: o.onAccount ? t('rpt.credit_account') : t('rpt.unpaid'),
    total: num(o.total),
    paid: num(o.paidAmount),
    due: num(o.balanceDue),
    age: Math.floor((now - o.createdAt.getTime()) / 86400000),
  }));
  const byCustomer = new Map<string, { customer: string; mobile: string; invoices: number; due: number; limit: number | null; oldest: number }>();
  for (const o of orders.filter((x) => x.onAccount && x.customer)) {
    const key = o.customerId!;
    const cur = byCustomer.get(key) ?? {
      customer: o.customer!.name,
      mobile: p.showPhone ? formatMobile(o.customer!.mobile) : '',
      invoices: 0,
      due: 0,
      limit: num(o.customer!.creditLimit) || null,
      oldest: 0,
    };
    cur.invoices++;
    cur.due = addBhd(cur.due, num(o.balanceDue));
    cur.oldest = Math.max(cur.oldest, Math.floor((now - o.createdAt.getTime()) / 86400000));
    byCustomer.set(key, cur);
  }
  const credit = [...byCustomer.values()].sort((a, b) => b.due - a.due);
  return {
    title: t('rpt.outstanding_credit_unpaid_orders'),
    subtitle: t('rpt.as_of', { date: new Date().toISOString().slice(0, 10) }),
    kpis: [
      { label: t('rpt.credit_accounts_outstanding'), value: sumCol(credit, 'due'), type: 'money' },
      { label: t('rpt.all_unpaid_balances'), value: sumCol(unpaid, 'due'), type: 'money' },
    ],
    tables: [
      {
        name: t('rpt.credit_accounts'),
        columns: [
          { key: 'customer', header: t('rpt.customer'), width: 26 },
          ...(p.showPhone ? [{ key: 'mobile', header: t('rpt.mobile'), width: 16 }] : []),
          { key: 'invoices', header: t('rpt.open_invoices'), type: 'number' as const },
          { key: 'limit', header: t('rpt.credit_limit'), type: 'money' as const },
          { key: 'due', header: t('rpt.outstanding'), type: 'money' as const },
          { key: 'oldest', header: t('rpt.oldest_days'), type: 'number' as const },
        ],
        rows: credit,
        totals: { customer: t('rpt.total'), invoices: countCol(credit, 'invoices'), due: sumCol(credit, 'due') },
      },
      {
        name: t('rpt.unpaid_orders'),
        title: t('rpt.unpaid_orders'),
        columns: [
          { key: 'orderNo', header: t('rpt.order'), type: 'number' },
          { key: 'date', header: t('rpt.date') },
          { key: 'customer', header: t('rpt.customer'), width: 24 },
          ...(p.showPhone ? [{ key: 'mobile', header: t('rpt.mobile'), width: 16 }] : []),
          { key: 'type', header: t('rpt.type') },
          { key: 'status', header: t('rpt.status') },
          { key: 'total', header: t('rpt.total'), type: 'money' as const },
          { key: 'paid', header: t('rpt.paid'), type: 'money' as const },
          { key: 'due', header: t('rpt.due'), type: 'money' as const },
          { key: 'age', header: t('rpt.age_days'), type: 'number' as const },
        ],
        rows: unpaid,
        totals: { orderNo: null, date: t('rpt.total'), total: sumCol(unpaid, 'total'), paid: sumCol(unpaid, 'paid'), due: sumCol(unpaid, 'due') },
      },
    ],
  };
}

export async function discountsCancellations(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const [discounted, cancelled] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId: p.tenantId, orderNo: { not: null }, discountTotal: { gt: 0 }, businessDate: dateRange(p) },
      include: { customer: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.order.findMany({
      where: { tenantId: p.tenantId, status: 'CANCELLED', orderNo: { not: null }, cancelledAt: range(p) },
      include: { customer: true, payments: { where: { kind: 'REFUND' } } },
      orderBy: { cancelledAt: 'asc' },
    }),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { tenantId: p.tenantId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const d = discounted.map((o) => ({
    orderNo: o.orderNo,
    date: o.businessDate,
    cashier: o.createdByName,
    customer: o.customer?.name ?? t('rpt.walk_in'),
    gross: addBhd(num(o.subtotal), num(o.expressSurcharge)),
    discount: num(o.discountTotal),
    pct: num(o.subtotal) + num(o.expressSurcharge) > 0 ? Math.round((num(o.discountTotal) / (num(o.subtotal) + num(o.expressSurcharge))) * 10000) / 100 : 0,
    total: num(o.total),
    status: o.status,
  }));
  const c = cancelled.map((o) => ({
    orderNo: o.orderNo,
    date: o.cancelledAt?.toISOString().slice(0, 10),
    by: o.cancelledById ? (users.get(o.cancelledById) ?? '') : '',
    customer: o.customer?.name ?? t('rpt.walk_in'),
    total: num(o.total),
    refunded: -sumBhd(o.payments.map((x) => num(x.amount))),
    reason: o.cancelReason,
  }));
  return {
    title: t('rpt.discounts_cancellations'),
    subtitle: period(p),
    kpis: [
      { label: t('rpt.discounts_given'), value: sumCol(d, 'discount'), type: 'money' },
      { label: t('rpt.cancelled_orders'), value: c.length, type: 'number' },
      { label: t('rpt.refunded'), value: sumCol(c, 'refunded'), type: 'money' },
    ],
    tables: [
      {
        name: t('rpt.discounts'),
        columns: [
          { key: 'orderNo', header: t('rpt.order'), type: 'number' },
          { key: 'date', header: t('rpt.date') },
          { key: 'cashier', header: t('rpt.cashier') },
          { key: 'customer', header: t('rpt.customer'), width: 22 },
          { key: 'gross', header: t('rpt.before_discount'), type: 'money' },
          { key: 'discount', header: t('rpt.discount'), type: 'money' },
          { key: 'pct', header: t('rpt.x'), type: 'percent' },
          { key: 'total', header: t('rpt.total'), type: 'money' },
          { key: 'status', header: t('rpt.status') },
        ],
        rows: d,
        totals: { orderNo: null, date: t('rpt.total'), gross: sumCol(d, 'gross'), discount: sumCol(d, 'discount'), total: sumCol(d, 'total') },
      },
      {
        name: t('rpt.cancellations'),
        title: t('rpt.cancelled_orders'),
        columns: [
          { key: 'orderNo', header: t('rpt.order'), type: 'number' },
          { key: 'date', header: t('rpt.cancelled_on') },
          { key: 'by', header: t('rpt.cancelled_by') },
          { key: 'customer', header: t('rpt.customer'), width: 22 },
          { key: 'total', header: t('rpt.order_total'), type: 'money' },
          { key: 'refunded', header: t('rpt.refunded'), type: 'money' },
          { key: 'reason', header: t('rpt.reason'), width: 30 },
        ],
        rows: c,
        totals: { orderNo: null, date: t('rpt.total'), total: sumCol(c, 'total'), refunded: sumCol(c, 'refunded') },
      },
    ],
  };
}

/** Orders received per cashier and pieces processed per worker (from status scans). */
export async function productivity(prisma: PrismaClient, p: ReportParams): Promise<ReportResult> {
  const [received, processed] = await Promise.all([
    prisma.order.groupBy({
      by: ['createdByName'],
      where: { tenantId: p.tenantId, orderNo: { not: null }, status: { not: 'CANCELLED' }, createdAt: range(p) },
      _count: true,
      _sum: { pieceCount: true },
    }),
    prisma.orderEvent.groupBy({
      by: ['userName', 'toStatus'],
      where: { tenantId: p.tenantId, type: { in: ['STATUS', 'DELIVERED'] }, createdAt: range(p) },
      _sum: { pieceCount: true },
    }),
  ]);
  const a = received
    .map((r) => ({ name: r.createdByName ?? '—', orders: r._count, pieces: r._sum.pieceCount ?? 0 }))
    .sort((x, y) => y.orders - x.orders);
  const workers = new Map<string, Record<string, number>>();
  for (const r of processed) {
    const name = r.userName ?? '—';
    const cur = workers.get(name) ?? { IN_PROCESS: 0, IRONING: 0, READY: 0, DELIVERED: 0 };
    cur[r.toStatus ?? ''] = (cur[r.toStatus ?? ''] ?? 0) + (r._sum.pieceCount ?? 0);
    workers.set(name, cur);
  }
  const b = [...workers.entries()]
    .map(([name, s]) => ({
      name,
      washing: s.IN_PROCESS ?? 0,
      ironing: s.IRONING ?? 0,
      ready: s.READY ?? 0,
      delivered: s.DELIVERED ?? 0,
      total: (s.IN_PROCESS ?? 0) + (s.IRONING ?? 0) + (s.READY ?? 0),
    }))
    .sort((x, y) => y.total - x.total);
  return {
    title: t('rpt.staff_productivity'),
    subtitle: period(p),
    tables: [
      {
        name: t('rpt.orders_received'),
        title: t('rpt.orders_received_per_cashier'),
        columns: [
          { key: 'name', header: t('rpt.staff'), width: 22 },
          { key: 'orders', header: t('rpt.orders'), type: 'number' },
          { key: 'pieces', header: t('rpt.pieces'), type: 'number' },
        ],
        rows: a,
        totals: { name: t('rpt.total'), orders: countCol(a, 'orders'), pieces: countCol(a, 'pieces') },
      },
      {
        name: t('rpt.pieces_processed'),
        title: t('rpt.pieces_processed_per_worker_status_scans'),
        columns: [
          { key: 'name', header: t('rpt.staff'), width: 22 },
          { key: 'washing', header: t('rpt.in_process'), type: 'number' },
          { key: 'ironing', header: t('rpt.ironing'), type: 'number' },
          { key: 'ready', header: t('rpt.ready'), type: 'number' },
          { key: 'total', header: t('rpt.processing_steps'), type: 'number' },
          { key: 'delivered', header: t('rpt.delivered'), type: 'number' },
        ],
        rows: b,
        totals: { name: t('rpt.total'), washing: countCol(b, 'washing'), ironing: countCol(b, 'ironing'), ready: countCol(b, 'ready'), total: countCol(b, 'total'), delivered: countCol(b, 'delivered') },
      },
    ],
  };
}

export const REPORTS: ReportDef[] = [
  { key: 'profit-loss', title: t('rpt.profit_loss'), module: 'finance_reports', group: 'finance', run: profitLoss },
  { key: 'sales-by-day', title: t('rpt.sales_by_day'), module: 'reports', group: 'sales', run: salesByDay },
  { key: 'sales-by-item', title: t('rpt.sales_by_item_type'), module: 'reports', group: 'sales', run: (pr, p) => salesByLine(pr, p, 'itemName', t('rpt.sales_by_item_type')) },
  { key: 'sales-by-service', title: t('rpt.sales_by_service'), module: 'reports', group: 'sales', run: (pr, p) => salesByLine(pr, p, 'serviceName', t('rpt.sales_by_service')) },
  { key: 'sales-by-payment', title: t('rpt.sales_by_payment_method'), module: 'reports', group: 'sales', run: salesByPaymentMethod },
  { key: 'sales-by-cashier', title: t('rpt.sales_by_cashier'), module: 'reports', group: 'sales', run: salesByCashier },
  { key: 'expenses-by-category', title: t('rpt.expenses_by_category'), module: 'finance_reports', group: 'finance', run: expensesByCategory },
  { key: 'outstanding', title: t('rpt.outstanding_credit_unpaid_orders'), module: 'reports', group: 'sales', run: outstanding },
  { key: 'customer-balances', title: t('rpt.customer_balances_liability'), module: 'finance_reports', group: 'finance', run: customerBalances },
  { key: 'vat', title: t('rpt.vat_report'), module: 'finance_reports', group: 'finance', run: vatReport },
  { key: 'discounts-cancellations', title: t('rpt.discounts_cancellations'), module: 'reports', group: 'sales', run: discountsCancellations },
  { key: 'productivity', title: t('rpt.staff_productivity'), module: 'reports', group: 'staff', run: productivity },
];

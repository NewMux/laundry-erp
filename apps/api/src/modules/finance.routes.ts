import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bhDate, fromFils, toFils } from '@laundry/shared';
import { assertDayOpen, currentBusinessDate } from '../lib/business-date';
import { audit, perm, requireTenant } from '../lib/context';
import { AppError, forbidden, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { ctxOf } from '../lib/service-context';
import { parse, zDate, zMoney, zOptStr } from '../lib/validate';
import { advanceRecurring, cashSummary, generateRecurringExpenses } from './finance.service';

const expenseMethod = z.enum(['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER']);

export default async function financeRoutes(app: FastifyInstance) {
  // ───── Expense categories ─────
  app.get('/categories', { preHandler: perm('expenses', 'view') }, async (req) => {
    return { categories: await app.tdb(req).expenseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }) };
  });

  app.post('/categories', { preHandler: perm('expenses', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(z.object({ name: z.string().trim().min(2).max(60) }), req.body);
    const db = app.tdb(req);
    const max = await db.expenseCategory.aggregate({ _max: { sortOrder: true } });
    return { category: await db.expenseCategory.create({ data: { tenantId: a.tenant.id, name: body.name, sortOrder: (max._max.sortOrder ?? 0) + 1 } }) };
  });

  app.patch('/categories/:id', { preHandler: perm('expenses', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() }), req.body);
    const db = app.tdb(req);
    const cat = await db.expenseCategory.findFirst({ where: { id } });
    if (!cat) throw notFound('Category');
    if (cat.isSystem && (body.name || body.isActive === false)) throw new AppError(400, 'SYSTEM_CATEGORY', `"${cat.name}" is used by payroll and cannot be renamed or disabled`);
    return { category: await db.expenseCategory.update({ where: { id }, data: body }) };
  });

  // ───── Expenses ─────
  const listSchema = z.object({
    from: zDate.optional(),
    to: zDate.optional(),
    categoryId: z.string().optional(),
    method: z.string().optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
  });

  app.get('/expenses', { preHandler: perm('expenses', 'view') }, async (req) => {
    const q = parse(listSchema, req.query);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    await generateRecurringExpenses(db, ctx);
    const where: Prisma.ExpenseWhereInput = {};
    if (q.from || q.to) where.date = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.method) where.method = q.method as never;
    if (q.q) where.OR = [{ vendor: { contains: q.q, mode: 'insensitive' } }, { notes: { contains: q.q, mode: 'insensitive' } }];
    const [expenses, total, sum] = await Promise.all([
      db.expense.findMany({
        where,
        include: { category: { select: { name: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.expense.count({ where }),
      db.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    const closed = new Set((await db.cashClosing.findMany({ where: { businessDate: { in: [...new Set(expenses.map((e) => e.date))] } }, select: { businessDate: true } })).map((c) => c.businessDate));
    return {
      expenses: expenses.map((e) => ({ ...e, locked: closed.has(e.date) || !!e.payrollRunId })),
      total,
      sum: num(sum._sum.amount),
    };
  });

  const expenseSchema = z.object({
    categoryId: z.string().min(1),
    amount: zMoney.refine((v) => v > 0, 'Amount must be more than zero'),
    date: zDate,
    method: expenseMethod.default('CASH'),
    vendor: zOptStr(120),
    notes: zOptStr(1000),
    attachmentIds: z.array(z.string()).max(5).default([]),
    recurring: z
      .object({ frequency: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']), endDate: zDate.nullish() })
      .nullish(),
  });

  app.post('/expenses', { preHandler: perm('expenses', 'create') }, async (req) => {
    const body = parse(expenseSchema, req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const cat = await db.expenseCategory.findFirst({ where: { id: body.categoryId } });
    if (!cat) throw notFound('Category');
    if (body.date > bhDate() && !body.recurring) throw new AppError(400, 'FUTURE_DATE', 'Expense date cannot be in the future');
    const expense = await db.$transaction(async (tx) => {
      let recurringId: string | null = null;
      const isFuture = body.date > bhDate();
      if (body.recurring) {
        const anchor = Number(body.date.slice(8, 10));
        const r = await tx.recurringExpense.create({
          data: {
            tenantId: ctx.tenantId,
            categoryId: body.categoryId,
            amount: body.amount,
            method: body.method,
            vendor: body.vendor ?? null,
            notes: body.notes ?? null,
            frequency: body.recurring.frequency,
            anchorDay: anchor,
            // A future first occurrence is generated when due; otherwise this entry is the first one.
            nextDate: isFuture ? body.date : advanceRecurring(body.date, body.recurring.frequency, anchor),
            endDate: body.recurring.endDate ?? null,
          },
        });
        recurringId = r.id;
        if (isFuture) return null;
      }
      await assertDayOpen(tx, body.date);
      return tx.expense.create({
        data: {
          tenantId: ctx.tenantId,
          categoryId: body.categoryId,
          amount: body.amount,
          date: body.date,
          method: body.method,
          vendor: body.vendor ?? null,
          notes: body.notes ?? null,
          attachmentIds: body.attachmentIds,
          recurringId,
          createdById: ctx.userId,
          createdByName: ctx.userName,
        },
      });
    });
    return { expense };
  });

  app.patch('/expenses/:id', { preHandler: perm('expenses', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(expenseSchema.omit({ recurring: true }), req.body);
    const db = app.tdb(req);
    const before = await db.expense.findFirst({ where: { id } });
    if (!before) throw notFound('Expense');
    if (before.payrollRunId || before.employeeId) throw new AppError(400, 'PAYROLL_EXPENSE', 'Salary expenses are managed from payroll');
    await assertDayOpen(db, before.date);
    await assertDayOpen(db, body.date);
    const expense = await db.expense.update({ where: { id }, data: body });
    await audit(db, req, 'expense.updated', 'expense', id, { amount: num(before.amount), date: before.date, categoryId: before.categoryId }, { amount: body.amount, date: body.date, categoryId: body.categoryId });
    return { expense };
  });

  app.delete('/expenses/:id', { preHandler: perm('expenses', 'delete') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const before = await db.expense.findFirst({ where: { id }, include: { category: true } });
    if (!before) throw notFound('Expense');
    if (before.payrollRunId || before.employeeId) throw new AppError(400, 'PAYROLL_EXPENSE', 'Salary expenses are managed from payroll');
    await assertDayOpen(db, before.date);
    await db.expense.delete({ where: { id } });
    await audit(db, req, 'expense.deleted', 'expense', id, { amount: num(before.amount), date: before.date, category: before.category.name, vendor: before.vendor }, null);
    return { ok: true };
  });

  // ───── Recurring templates ─────
  app.get('/recurring', { preHandler: perm('expenses', 'view') }, async (req) => {
    const db = app.tdb(req);
    const list = await db.recurringExpense.findMany({ orderBy: { createdAt: 'desc' } });
    const cats = new Map((await db.expenseCategory.findMany()).map((c) => [c.id, c.name]));
    return { recurring: list.map((r) => ({ ...r, categoryName: cats.get(r.categoryId) ?? '' })) };
  });

  app.patch('/recurring/:id', { preHandler: perm('expenses', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ isActive: z.boolean().optional(), amount: zMoney.optional(), endDate: zDate.nullish() }), req.body);
    const db = app.tdb(req);
    if (!(await db.recurringExpense.findFirst({ where: { id } }))) throw notFound('Recurring expense');
    return { recurring: await db.recurringExpense.update({ where: { id }, data: body }) };
  });

  // ───── Daily cash closing ─────
  app.get('/cash', { preHandler: perm('cash_closing', 'view') }, async (req) => {
    const q = parse(z.object({ date: zDate.optional(), openingFloat: z.coerce.number().min(0).optional() }), req.query);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const date = q.date ?? (await currentBusinessDate(db));
    const last = await db.cashClosing.findFirst({ where: { businessDate: { lt: date } }, orderBy: { businessDate: 'desc' } });
    return { summary: await cashSummary(db, ctx, date, q.openingFloat), currentBusinessDate: await currentBusinessDate(db), lastClosed: last?.businessDate ?? null };
  });

  app.get('/cash/history', { preHandler: perm('cash_closing', 'view') }, async (req) => {
    const q = parse(z.object({ from: zDate.optional(), to: zDate.optional() }), req.query);
    const closings = await app.tdb(req).cashClosing.findMany({
      where: q.from || q.to ? { businessDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : undefined,
      orderBy: { businessDate: 'desc' },
      take: 120,
    });
    return { closings };
  });

  /** Close the day: expected vs counted cash, difference needs a reason. The day is then locked. */
  app.post('/cash/close', { preHandler: perm('cash_closing', 'create') }, async (req) => {
    const body = parse(
      z.object({ date: zDate, openingFloat: zMoney, countedCash: zMoney, reason: zOptStr(500) }),
      req.body,
    );
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    if (body.date > bhDate()) throw new AppError(400, 'FUTURE_DATE', 'You cannot close a future day');
    const closing = await db.$transaction(async (tx) => {
      const existing = await tx.cashClosing.findFirst({ where: { businessDate: body.date } });
      if (existing) throw new AppError(409, 'DAY_CLOSED', 'This day is already closed');
      const s = await cashSummary(tx, ctx, body.date, body.openingFloat);
      const difference = fromFils(toFils(body.countedCash) - toFils(s.expectedCash));
      if (difference !== 0 && !body.reason) throw new AppError(400, 'REASON_REQUIRED', 'Explain the difference between expected and counted cash');
      return tx.cashClosing.create({
        data: {
          tenantId: ctx.tenantId,
          businessDate: body.date,
          openingFloat: body.openingFloat,
          cashSales: s.cashSales,
          cashTopups: s.cashTopups,
          cashRefunds: s.cashRefunds,
          cashExpenses: s.cashExpenses,
          expectedCash: s.expectedCash,
          countedCash: body.countedCash,
          difference,
          reason: body.reason ?? null,
          closedById: ctx.userId,
          closedByName: ctx.userName,
        },
      });
    });
    await audit(db, req, 'cash.closed', 'cash_closing', closing.id, null, {
      date: body.date,
      expected: num(closing.expectedCash),
      counted: num(closing.countedCash),
      difference: num(closing.difference),
    }, body.reason);
    return { closing };
  });

  /** Owner-only escape hatch: reopen a closed day (audited). */
  app.post('/cash/reopen', { preHandler: perm('cash_closing', 'delete') }, async (req) => {
    const a = requireTenant(req);
    if (a.roleKey !== 'OWNER' && !a.supportMode) throw forbidden('Only the owner can reopen a closed day');
    const body = parse(z.object({ date: zDate, reason: z.string().trim().min(3).max(300) }), req.body);
    const db = app.tdb(req);
    const c = await db.cashClosing.findFirst({ where: { businessDate: body.date } });
    if (!c) throw notFound('Closing');
    await db.cashClosing.delete({ where: { id: c.id } });
    await audit(db, req, 'cash.reopened', 'cash_closing', c.id, { date: c.businessDate, counted: num(c.countedCash), expected: num(c.expectedCash) }, null, body.reason);
    return { ok: true };
  });

}

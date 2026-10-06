import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SALARIES_CATEGORY, bhDate, daysBetween, fromFils, monthRange, sumBhd, toFils } from '@laundry/shared';
import { assertDayOpen } from '../lib/business-date';
import { audit, perm, requireTenant } from '../lib/context';
import { AppError, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { parse, zDate, zMonth } from '../lib/validate';

interface Allowance {
  name: string;
  amount: number;
}

export default async function payrollRoutes(app: FastifyInstance) {
  app.get('/runs', { preHandler: perm('payroll', 'view') }, async (req) => {
    const runs = await app.tdb(req).payrollRun.findMany({ orderBy: { month: 'desc' }, include: { _count: { select: { items: true } } } });
    return { runs };
  });

  app.get('/runs/:id', { preHandler: perm('payroll', 'view') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const run = await app.tdb(req).payrollRun.findFirst({ where: { id }, include: { items: { orderBy: { employeeName: 'asc' } } } });
    if (!run) throw notFound('Payroll');
    return { run };
  });

  /**
   * Prepare (or recalculate) the payroll of a month:
   * net = basic + allowances − deductions − advances.
   * Unpaid leave is deducted at basic/30 per day.
   */
  app.post('/runs', { preHandler: perm('payroll', 'create') }, async (req) => {
    const a = requireTenant(req);
    const { month } = parse(z.object({ month: zMonth }), req.body);
    const { from, to } = monthRange(month);
    const db = app.tdb(req);
    const run = await db.$transaction(async (tx) => {
      let run = await tx.payrollRun.findFirst({ where: { month } });
      if (run?.status === 'PAID') throw new AppError(409, 'PAID', 'This payroll is already paid');
      if (!run) run = await tx.payrollRun.create({ data: { tenantId: a.tenant.id, month } });
      await tx.payrollItem.deleteMany({ where: { payrollRunId: run.id } });
      const employees = await tx.employee.findMany({
        where: { isActive: true, OR: [{ joinDate: null }, { joinDate: { lte: to } }] },
        orderBy: { name: 'asc' },
      });
      let total = 0;
      for (const e of employees) {
        const [adjustments, leaves, attendance] = await Promise.all([
          tx.employeeAdjustment.findMany({ where: { employeeId: e.id, payrollItemId: null, date: { lte: to } } }),
          tx.leaveRecord.findMany({ where: { employeeId: e.id, type: 'UNPAID', startDate: { lte: to }, endDate: { gte: from } } }),
          tx.attendance.count({ where: { employeeId: e.id, date: { gte: from, lte: to }, status: 'PRESENT' } }),
        ]);
        const basic = num(e.basicSalary);
        const allowanceList = ((e.allowances as unknown as Allowance[]) ?? []).map((x) => ({ name: x.name, amount: Number(x.amount) || 0 }));
        const allowances = sumBhd(allowanceList.map((x) => x.amount));
        let unpaidDays = 0;
        for (const l of leaves) {
          const s = l.startDate < from ? from : l.startDate;
          const en = l.endDate > to ? to : l.endDate;
          const span = daysBetween(s, en) + 1;
          const total = daysBetween(l.startDate, l.endDate) + 1;
          unpaidDays += Math.min(span, num(l.days) * (span / Math.max(1, total)));
        }
        unpaidDays = Math.round(unpaidDays * 10) / 10;
        const leaveDeduction = fromFils(Math.round((toFils(basic) / 30) * unpaidDays));
        const deductions = sumBhd([...adjustments.filter((x) => x.type === 'DEDUCTION').map((x) => num(x.amount)), leaveDeduction]);
        const advances = sumBhd(adjustments.filter((x) => x.type === 'ADVANCE').map((x) => num(x.amount)));
        const net = fromFils(toFils(basic) + toFils(allowances) - toFils(deductions) - toFils(advances));
        await tx.payrollItem.create({
          data: {
            tenantId: a.tenant.id,
            payrollRunId: run.id,
            employeeId: e.id,
            employeeName: e.name,
            position: e.position,
            basic,
            allowances,
            allowanceDetails: allowanceList as object,
            deductions,
            advances,
            net,
            daysWorked: attendance,
            unpaidLeaveDays: unpaidDays,
          },
        });
        total += toFils(net);
      }
      return tx.payrollRun.update({ where: { id: run.id }, data: { totalNet: fromFils(total) }, include: { items: { orderBy: { employeeName: 'asc' } } } });
    });
    return { run };
  });

  /**
   * Mark payroll as paid. Each employee's net pay is posted automatically as a
   * Salaries expense (advances were already expensed when paid out), and the
   * advances/deductions included are settled.
   */
  app.post('/runs/:id/pay', { preHandler: perm('payroll', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ date: zDate.default(bhDate()), method: z.enum(['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER']).default('BANK_TRANSFER') }), req.body ?? {});
    const db = app.tdb(req);
    const run = await db.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id }, include: { items: true } });
      if (!run) throw notFound('Payroll');
      if (run.status === 'PAID') throw new AppError(409, 'PAID', 'This payroll is already paid');
      if (!run.items.length) throw new AppError(400, 'EMPTY', 'There are no employees in this payroll');
      await assertDayOpen(tx, body.date);
      const cat = await tx.expenseCategory.findFirst({ where: { name: SALARIES_CATEGORY } });
      if (!cat) throw new AppError(500, 'NO_CATEGORY', 'Salaries category missing');
      const { to } = monthRange(run.month);
      for (const item of run.items) {
        let expenseId: string | null = null;
        if (num(item.net) > 0) {
          const exp = await tx.expense.create({
            data: {
              tenantId: a.tenant.id,
              categoryId: cat.id,
              amount: item.net,
              date: body.date,
              method: body.method,
              vendor: item.employeeName,
              notes: `Salary ${run.month}`,
              payrollRunId: run.id,
              employeeId: item.employeeId,
              createdById: a.user.id,
              createdByName: a.user.name,
            },
          });
          expenseId = exp.id;
        }
        await tx.payrollItem.update({ where: { id: item.id }, data: { expenseId } });
        await tx.employeeAdjustment.updateMany({
          // Only entries that existed when the payroll was calculated are settled by it.
          where: { employeeId: item.employeeId, payrollItemId: null, date: { lte: to }, createdAt: { lte: run.updatedAt } },
          data: { payrollItemId: item.id },
        });
      }
      return tx.payrollRun.update({
        where: { id },
        data: { status: 'PAID', paidAt: new Date(), paidDate: body.date, paidById: a.user.id, paymentMethod: body.method },
        include: { items: { orderBy: { employeeName: 'asc' } } },
      });
    });
    await audit(db, req, 'payroll.paid', 'payroll', id, null, { month: run.month, totalNet: num(run.totalNet), date: body.date, method: body.method });
    return { run };
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SALARIES_CATEGORY, addDays, bhDate, can, daysBetween, hasCap, monthRange, weekday } from '@laundry/shared';
import { assertDayOpen } from '../lib/business-date';
import { anyPerm, audit, perm, requireAuth, requireTenant } from '../lib/context';
import { AppError, forbidden, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { parse, zDate, zMoney, zMonth, zOptStr } from '../lib/validate';

const allowanceSchema = z.array(z.object({ name: z.string().trim().min(1).max(40), amount: zMoney })).max(10);

const employeeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  position: zOptStr(60),
  phone: zOptStr(30),
  nationality: zOptStr(60),
  cpr: zOptStr(20),
  cprExpiry: zDate.nullish(),
  passportNo: zOptStr(30),
  passportExpiry: zDate.nullish(),
  visaExpiry: zDate.nullish(),
  joinDate: zDate.nullish(),
  basicSalary: zMoney.default(0),
  allowances: allowanceSchema.default([]),
  annualLeaveDays: z.number().min(0).max(365).nullish(),
  isActive: z.boolean().default(true),
  notes: zOptStr(1000),
});

const SALARY_FIELDS = ['basicSalary', 'allowances'] as const;

export interface ExpiryAlert {
  employeeId: string;
  employeeName: string;
  document: string;
  expiryDate: string;
  daysLeft: number;
  level: 'expired' | 'week' | 'month';
}

/** CPR / passport / visa (and uploaded document) expiries within 30 days. */
export async function expiryAlerts(app: FastifyInstance, req: FastifyRequest): Promise<ExpiryAlert[]> {
  const db = app.tdb(req);
  const today = bhDate();
  const limit = addDays(today, 30);
  const employees = await db.employee.findMany({ where: { isActive: true }, include: { documents: true } });
  const out: ExpiryAlert[] = [];
  const push = (e: { id: string; name: string }, document: string, date: string | null | undefined) => {
    if (!date || date > limit) return;
    const daysLeft = daysBetween(today, date);
    out.push({ employeeId: e.id, employeeName: e.name, document, expiryDate: date, daysLeft, level: daysLeft < 0 ? 'expired' : daysLeft <= 7 ? 'week' : 'month' });
  };
  for (const e of employees) {
    push(e, 'CPR', e.cprExpiry);
    push(e, 'Passport', e.passportExpiry);
    push(e, 'Visa / work permit', e.visaExpiry);
    for (const d of e.documents) push(e, `Document: ${d.type}${d.note ? ` (${d.note})` : ''}`, d.expiryDate);
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

function canSeeSalary(req: FastifyRequest) {
  const a = requireTenant(req);
  return hasCap(a.perms, 'editSalary') || can(a.perms, 'payroll', 'view');
}

export default async function staffRoutes(app: FastifyInstance) {
  function shapeEmployee(req: FastifyRequest, e: Record<string, unknown>) {
    if (canSeeSalary(req)) return e;
    const { basicSalary, allowances, ...rest } = e;
    void basicSalary, allowances;
    return rest;
  }

  // ───── Employees ─────
  app.get('/employees', { preHandler: anyPerm(['staff', 'view'], ['attendance', 'view'], ['payroll', 'view']) }, async (req) => {
    const { all } = parse(z.object({ all: z.string().optional() }), req.query);
    const employees = await app.tdb(req).employee.findMany({
      where: all ? undefined : { isActive: true },
      include: { user: { select: { id: true, username: true, role: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    return { employees: employees.map((e) => shapeEmployee(req, e)) };
  });

  app.get('/employees/:id', { preHandler: perm('staff', 'view') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const e = await db.employee.findFirst({
      where: { id },
      include: { documents: { orderBy: { createdAt: 'desc' } }, user: { select: { id: true, username: true, name: true } } },
    });
    if (!e) throw notFound('Employee');
    const files = await db.fileObject.findMany({ where: { id: { in: e.documents.map((d) => d.fileId) } }, select: { id: true, originalName: true, mimeType: true } });
    return { employee: shapeEmployee(req, { ...e, documents: e.documents.map((d) => ({ ...d, file: files.find((f) => f.id === d.fileId) ?? null })) }) };
  });

  app.post('/employees', { preHandler: perm('staff', 'create') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(employeeSchema, req.body);
    if (!hasCap(a.perms, 'editSalary')) {
      body.basicSalary = 0;
      body.allowances = [];
    }
    const e = await app.tdb(req).employee.create({ data: { ...body, tenantId: a.tenant.id, allowances: body.allowances as object } });
    return { employee: e };
  });

  app.patch('/employees/:id', { preHandler: perm('staff', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(employeeSchema.partial(), req.body);
    const db = app.tdb(req);
    const before = await db.employee.findFirst({ where: { id } });
    if (!before) throw notFound('Employee');
    const salaryChange =
      (body.basicSalary !== undefined && body.basicSalary !== num(before.basicSalary)) ||
      (body.allowances !== undefined && JSON.stringify(body.allowances) !== JSON.stringify(before.allowances));
    if (salaryChange && !hasCap(a.perms, 'editSalary')) throw forbidden('You are not allowed to change salaries');
    if (!hasCap(a.perms, 'editSalary')) for (const f of SALARY_FIELDS) delete (body as Record<string, unknown>)[f];
    const e = await db.employee.update({ where: { id }, data: { ...body, allowances: body.allowances as object | undefined } });
    if (salaryChange) {
      await audit(db, req, 'employee.salary_changed', 'employee', id, { basicSalary: num(before.basicSalary), allowances: before.allowances }, { basicSalary: num(e.basicSalary), allowances: e.allowances });
    }
    return { employee: shapeEmployee(req, e) };
  });

  // ───── Documents ─────
  app.post('/employees/:id/documents', { preHandler: perm('staff', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(
      z.object({ type: z.enum(['CPR', 'PASSPORT', 'VISA', 'CONTRACT', 'OTHER']), fileId: z.string().min(1), expiryDate: zDate.nullish(), note: zOptStr(200) }),
      req.body,
    );
    const db = app.tdb(req);
    if (!(await db.employee.findFirst({ where: { id } }))) throw notFound('Employee');
    if (!(await db.fileObject.findFirst({ where: { id: body.fileId } }))) throw notFound('File');
    const doc = await db.employeeDocument.create({ data: { ...body, tenantId: a.tenant.id, employeeId: id, expiryDate: body.expiryDate ?? null } });
    return { document: doc };
  });

  app.delete('/documents/:id', { preHandler: perm('staff', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    if (!(await db.employeeDocument.findFirst({ where: { id } }))) throw notFound('Document');
    await db.employeeDocument.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/alerts', { preHandler: anyPerm(['staff', 'view'], ['dashboard', 'view']) }, async (req) => ({ alerts: await expiryAlerts(app, req) }));

  // ───── Attendance ─────

  async function myEmployee(req: FastifyRequest) {
    const a = requireAuth(req);
    if (!a.user.employeeId) throw new AppError(400, 'NO_EMPLOYEE', 'Your user is not linked to an employee profile');
    const e = await app.tdb(req).employee.findFirst({ where: { id: a.user.employeeId } });
    if (!e) throw notFound('Employee');
    return e;
  }

  app.get('/attendance/me', async (req) => {
    requireTenant(req);
    const a = requireAuth(req);
    if (!a.user.employeeId) return { linked: false };
    const rec = await app.tdb(req).attendance.findFirst({ where: { employeeId: a.user.employeeId, date: bhDate() } });
    return { linked: true, today: rec };
  });

  /** Self check-in with the logged-in user (any role linked to an employee). */
  app.post('/attendance/check-in', async (req) => {
    const a = requireTenant(req);
    const e = await myEmployee(req);
    const date = bhDate();
    const db = app.tdb(req);
    const existing = await db.attendance.findFirst({ where: { employeeId: e.id, date } });
    if (existing?.checkIn) throw new AppError(409, 'ALREADY_IN', 'You have already checked in today');
    const rec = existing
      ? await db.attendance.update({ where: { id: existing.id }, data: { checkIn: new Date(), status: 'PRESENT', source: 'SELF' } })
      : await db.attendance.create({ data: { tenantId: a.tenant.id, employeeId: e.id, date, checkIn: new Date(), status: 'PRESENT', source: 'SELF', createdById: a.user.id } });
    return { attendance: rec };
  });

  app.post('/attendance/check-out', async (req) => {
    requireTenant(req);
    const e = await myEmployee(req);
    const db = app.tdb(req);
    const rec = await db.attendance.findFirst({ where: { employeeId: e.id, date: bhDate() } });
    if (!rec?.checkIn) throw new AppError(409, 'NOT_IN', 'You have not checked in today');
    return { attendance: await db.attendance.update({ where: { id: rec.id }, data: { checkOut: new Date() } }) };
  });

  /** Monthly attendance sheet: employees × days. */
  app.get('/attendance', { preHandler: perm('attendance', 'view') }, async (req) => {
    const { month } = parse(z.object({ month: zMonth.default(bhDate().slice(0, 7)) }), req.query);
    const { from, to } = monthRange(month);
    const db = app.tdb(req);
    const [employees, records, leaves] = await Promise.all([
      db.employee.findMany({ where: { OR: [{ isActive: true }, { attendance: { some: { date: { gte: from, lte: to } } } }] }, orderBy: { name: 'asc' }, select: { id: true, name: true, position: true } }),
      db.attendance.findMany({ where: { date: { gte: from, lte: to } } }),
      db.leaveRecord.findMany({ where: { startDate: { lte: to }, endDate: { gte: from } } }),
    ]);
    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    return {
      month,
      days: days.map((d) => ({ date: d, weekday: weekday(d) })),
      employees,
      records,
      leaves: leaves.map((l) => ({ employeeId: l.employeeId, type: l.type, startDate: l.startDate, endDate: l.endDate })),
    };
  });

  /** Manual attendance entry / correction by a manager. */
  app.put('/attendance', { preHandler: anyPerm(['attendance', 'create'], ['attendance', 'edit']) }, async (req) => {
    const a = requireTenant(req);
    const body = parse(
      z.object({
        employeeId: z.string().min(1),
        date: zDate,
        checkIn: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
        checkOut: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
        status: z.enum(['PRESENT', 'ABSENT', 'LEAVE', 'OFF']).default('PRESENT'),
        note: zOptStr(200),
      }),
      req.body,
    );
    const db = app.tdb(req);
    if (!(await db.employee.findFirst({ where: { id: body.employeeId } }))) throw notFound('Employee');
    const at = (hhmm?: string | null) => (hhmm ? new Date(`${body.date}T${hhmm}:00+03:00`) : null);
    const data = { checkIn: at(body.checkIn), checkOut: at(body.checkOut), status: body.status, note: body.note ?? null, source: 'MANUAL' };
    const existing = await db.attendance.findFirst({ where: { employeeId: body.employeeId, date: body.date } });
    const rec = existing
      ? await db.attendance.update({ where: { id: existing.id }, data })
      : await db.attendance.create({ data: { ...data, tenantId: a.tenant.id, employeeId: body.employeeId, date: body.date, createdById: a.user.id } });
    if (existing) await audit(db, req, 'attendance.corrected', 'attendance', rec.id, { checkIn: existing.checkIn, checkOut: existing.checkOut, status: existing.status }, data);
    return { attendance: rec };
  });

  // ───── Advances & deductions ─────
  app.get('/adjustments', { preHandler: perm('payroll', 'view') }, async (req) => {
    const q = parse(z.object({ employeeId: z.string().optional(), month: zMonth.optional() }), req.query);
    const where: Record<string, unknown> = {};
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.month) where.date = { gte: monthRange(q.month).from, lte: monthRange(q.month).to };
    const list = await app.tdb(req).employeeAdjustment.findMany({ where, include: { employee: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 500 });
    return { adjustments: list };
  });

  /**
   * Record an advance (money paid to the employee now, deducted from the next
   * payroll) or a deduction (penalty etc.). Advances are posted to Salaries
   * expenses when paid out, so payroll later only posts the net pay.
   */
  app.post('/adjustments', { preHandler: perm('payroll', 'create') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(
      z.object({
        employeeId: z.string().min(1),
        type: z.enum(['ADVANCE', 'DEDUCTION']),
        amount: zMoney.refine((v) => v > 0, 'Amount must be more than zero'),
        date: zDate,
        method: z.enum(['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER']).nullish(),
        note: zOptStr(300),
      }),
      req.body,
    );
    const db = app.tdb(req);
    const emp = await db.employee.findFirst({ where: { id: body.employeeId } });
    if (!emp) throw notFound('Employee');
    const adj = await db.$transaction(async (tx) => {
      let expenseId: string | null = null;
      if (body.type === 'ADVANCE') {
        await assertDayOpen(tx, body.date);
        const cat = await tx.expenseCategory.findFirst({ where: { name: SALARIES_CATEGORY } });
        if (!cat) throw new AppError(500, 'NO_CATEGORY', 'Salaries category missing');
        const exp = await tx.expense.create({
          data: {
            tenantId: a.tenant.id,
            categoryId: cat.id,
            amount: body.amount,
            date: body.date,
            method: body.method ?? 'CASH',
            vendor: emp.name,
            notes: `Salary advance${body.note ? `: ${body.note}` : ''}`,
            employeeId: emp.id,
            createdById: a.user.id,
            createdByName: a.user.name,
          },
        });
        expenseId = exp.id;
      }
      return tx.employeeAdjustment.create({
        data: {
          tenantId: a.tenant.id,
          employeeId: emp.id,
          type: body.type,
          amount: body.amount,
          date: body.date,
          method: body.type === 'ADVANCE' ? (body.method ?? 'CASH') : null,
          note: body.note ?? null,
          expenseId,
          createdById: a.user.id,
        },
      });
    });
    await audit(db, req, `employee.${body.type.toLowerCase()}`, 'employee', emp.id, null, { amount: body.amount, date: body.date, note: body.note });
    return { adjustment: adj };
  });

  app.delete('/adjustments/:id', { preHandler: perm('payroll', 'delete') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const adj = await db.employeeAdjustment.findFirst({ where: { id } });
    if (!adj) throw notFound('Adjustment');
    if (adj.payrollItemId) throw new AppError(409, 'SETTLED', 'This entry is already included in a paid payroll');
    await db.$transaction(async (tx) => {
      if (adj.expenseId) {
        await assertDayOpen(tx, adj.date);
        await tx.expense.deleteMany({ where: { id: adj.expenseId } });
      }
      await tx.employeeAdjustment.delete({ where: { id } });
    });
    await audit(db, req, 'employee.adjustment_deleted', 'employee', adj.employeeId, { type: adj.type, amount: num(adj.amount), date: adj.date }, null);
    return { ok: true };
  });

  // ───── Leave ─────
  app.get('/leave', { preHandler: perm('staff', 'view') }, async (req) => {
    const q = parse(z.object({ employeeId: z.string().optional(), year: z.coerce.number().int().min(2000).max(2100).default(Number(bhDate().slice(0, 4))) }), req.query);
    const from = `${q.year}-01-01`;
    const to = `${q.year}-12-31`;
    const db = app.tdb(req);
    const records = await db.leaveRecord.findMany({
      where: { ...(q.employeeId ? { employeeId: q.employeeId } : {}), startDate: { lte: to }, endDate: { gte: from } },
      include: { employee: { select: { name: true } } },
      orderBy: { startDate: 'desc' },
    });
    const a = requireTenant(req);
    const employees = await db.employee.findMany({ where: q.employeeId ? { id: q.employeeId } : { isActive: true }, orderBy: { name: 'asc' } });
    const balances = employees.map((e) => {
      const mine = records.filter((r) => r.employeeId === e.id);
      const used = (type: string) => mine.filter((r) => r.type === type).reduce((s, r) => s + num(r.days), 0);
      const entitlement = e.annualLeaveDays !== null ? num(e.annualLeaveDays) : a.settings.annualLeaveDays;
      return {
        employeeId: e.id,
        name: e.name,
        annual: { entitlement, used: used('ANNUAL'), balance: entitlement - used('ANNUAL') },
        sick: { entitlement: a.settings.sickLeaveDays, used: used('SICK'), balance: a.settings.sickLeaveDays - used('SICK') },
        unpaid: { used: used('UNPAID') },
      };
    });
    return { year: q.year, records, balances };
  });

  app.post('/leave', { preHandler: perm('staff', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(
      z.object({ employeeId: z.string().min(1), type: z.enum(['ANNUAL', 'SICK', 'UNPAID']), startDate: zDate, endDate: zDate, days: z.number().min(0.5).max(365).nullish(), note: zOptStr(300) }),
      req.body,
    );
    if (body.endDate < body.startDate) throw new AppError(400, 'BAD_RANGE', 'End date is before start date');
    const db = app.tdb(req);
    if (!(await db.employee.findFirst({ where: { id: body.employeeId } }))) throw notFound('Employee');
    const days = body.days ?? daysBetween(body.startDate, body.endDate) + 1;
    const rec = await db.leaveRecord.create({ data: { ...body, days, tenantId: a.tenant.id, note: body.note ?? null, createdById: a.user.id } });
    return { leave: rec };
  });

  app.delete('/leave/:id', { preHandler: perm('staff', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    if (!(await db.leaveRecord.findFirst({ where: { id } }))) throw notFound('Leave');
    await db.leaveRecord.delete({ where: { id } });
    return { ok: true };
  });
}

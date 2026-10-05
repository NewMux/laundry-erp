import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { addBhd, formatMobile, fromFils, hasCap, isValidMobile, normalizeMobile, toFils } from '@laundry/shared';
import { anyPerm, audit, perm, requireTenant } from '../lib/context';
import { readSheet, tableToCsv, tablesToXlsx, type Table } from '../lib/excel';
import { AppError, badRequest, notFound } from '../lib/errors';
import { cryptoId } from '../lib/ids';
import { num } from '../lib/prisma';
import { ctxOf, nextReceiptNo } from '../lib/service-context';
import { parse, zMoney, zOptStr } from '../lib/validate';
import { applyOrderPayments, refreshPaymentState } from './orders.service';
import { currentBusinessDate } from '../lib/business-date';

const mobileSchema = z
  .string()
  .trim()
  .refine(isValidMobile, 'Enter a valid mobile number')
  .transform((v) => normalizeMobile(v));

const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mobile: mobileSchema,
  altPhone: zOptStr(30),
  email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
  cpr: zOptStr(20),
  type: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
  notes: zOptStr(1000),
  addrFlat: zOptStr(40),
  addrHouse: zOptStr(40),
  addrRoad: zOptStr(40),
  addrBlock: zOptStr(40),
  addrArea: zOptStr(80),
  addrBuilding: zOptStr(80),
  mapUrl: zOptStr(500),
  creditEnabled: z.boolean().default(false),
  creditLimit: zMoney.default(0),
});

const LIST_SELECT = {
  id: true,
  name: true,
  mobile: true,
  altPhone: true,
  email: true,
  type: true,
  walletPaid: true,
  walletBonus: true,
  creditEnabled: true,
  creditLimit: true,
  createdAt: true,
  isActive: true,
} satisfies Prisma.CustomerSelect;

export default async function customersRoutes(app: FastifyInstance) {
  const canLookup = anyPerm(['customers', 'view'], ['pos', 'create'], ['wallet', 'view'], ['delivery', 'view']);

  function maskPhone(req: FastifyRequest, c: Record<string, unknown>) {
    if (hasCap(req.auth!.perms, 'viewCustomerPhone')) return c;
    const { mobile, altPhone, ...rest } = c;
    void mobile, altPhone;
    return rest;
  }

  async function withStats(req: FastifyRequest, ids: string[]) {
    const db = app.tdb(req);
    const [spent, outstanding, last] = await Promise.all([
      db.order.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: { notIn: ['CANCELLED', 'DRAFT'] } }, _sum: { total: true }, _count: true }),
      db.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: { notIn: ['CANCELLED', 'DRAFT'] }, balanceDue: { gt: 0 } },
        _sum: { balanceDue: true },
      }),
      db.order.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, orderNo: { not: null } }, _max: { createdAt: true } }),
    ]);
    const m = new Map<string, { totalSpent: number; orders: number; outstanding: number; lastVisit: Date | null }>();
    for (const id of ids) m.set(id, { totalSpent: 0, orders: 0, outstanding: 0, lastVisit: null });
    for (const s of spent) if (s.customerId) Object.assign(m.get(s.customerId)!, { totalSpent: num(s._sum.total), orders: s._count });
    for (const s of outstanding) if (s.customerId) m.get(s.customerId)!.outstanding = num(s._sum.balanceDue);
    for (const s of last) if (s.customerId) m.get(s.customerId)!.lastVisit = s._max.createdAt;
    return m;
  }

  const listSchema = z.object({
    q: z.string().trim().max(100).optional(),
    type: z.enum(['INDIVIDUAL', 'COMPANY']).optional(),
    filter: z.enum(['all', 'balance', 'credit', 'outstanding']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  });

  function buildWhere(req: FastifyRequest, q: z.infer<typeof listSchema>): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = {};
    if (q.type) where.type = q.type;
    if (q.filter === 'balance') where.OR = [{ walletPaid: { gt: 0 } }, { walletBonus: { gt: 0 } }];
    if (q.filter === 'credit') where.creditEnabled = true;
    if (q.filter === 'outstanding') where.orders = { some: { balanceDue: { gt: 0 }, status: { notIn: ['CANCELLED', 'DRAFT'] } } };
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      const or: Prisma.CustomerWhereInput[] = [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }];
      if (digits.length >= 3 && hasCap(req.auth!.perms, 'viewCustomerPhone')) {
        or.push({ mobile: { contains: digits } }, { altPhone: { contains: digits } }, { cpr: { contains: digits } });
      }
      where.AND = [{ OR: or }];
    }
    return where;
  }

  app.get('/', { preHandler: perm('customers', 'view') }, async (req) => {
    const q = parse(listSchema, req.query);
    const db = app.tdb(req);
    const where = buildWhere(req, q);
    const [customers, total] = await Promise.all([
      db.customer.findMany({ where, select: LIST_SELECT, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.customer.count({ where }),
    ]);
    const stats = await withStats(req, customers.map((c) => c.id));
    return {
      customers: customers.map((c) => maskPhone(req, { ...c, ...stats.get(c.id) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  /** POS step 1: find a customer by phone number (partial match). */
  app.get('/lookup', { preHandler: canLookup }, async (req) => {
    const { phone, q } = parse(z.object({ phone: z.string().optional(), q: z.string().optional() }), req.query);
    const db = app.tdb(req);
    const digits = (phone ?? '').replace(/\D/g, '');
    const where: Prisma.CustomerWhereInput = {};
    if (digits.length >= 3) {
      const normalized = normalizeMobile(digits);
      where.OR = [{ mobile: normalized }, { mobile: { contains: digits } }, { altPhone: { contains: digits } }];
    } else if (q && q.trim().length >= 2) {
      where.name = { contains: q.trim(), mode: 'insensitive' };
    } else return { customers: [] };
    const customers = await db.customer.findMany({ where, select: LIST_SELECT, take: 10, orderBy: { name: 'asc' } });
    const exact = customers.find((c) => c.mobile === normalizeMobile(digits));
    const ordered = exact ? [exact, ...customers.filter((c) => c !== exact)] : customers;
    return { customers: ordered.map((c) => maskPhone(req, c)) };
  });

  app.post('/', { preHandler: anyPerm(['customers', 'create'], ['pos', 'create']) }, async (req) => {
    const a = requireTenant(req);
    const body = parse(customerSchema, req.body);
    const db = app.tdb(req);
    if (await db.customer.findFirst({ where: { mobile: body.mobile } })) {
      throw new AppError(409, 'MOBILE_TAKEN', `A customer with mobile ${formatMobile(body.mobile)} already exists`);
    }
    if ((body.creditEnabled || body.creditLimit) && !a.perms.modules.customers?.includes('edit')) {
      body.creditEnabled = false;
      body.creditLimit = 0;
    }
    const c = await db.customer.create({ data: { ...body, tenantId: a.tenant.id, createdById: a.user.id } });
    return { customer: c };
  });

  app.get('/:id', { preHandler: canLookup }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const c = await db.customer.findFirst({ where: { id } });
    if (!c) throw notFound('Customer');
    const stats = (await withStats(req, [id])).get(id)!;
    const packages = await db.customerPackage.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' } });
    return {
      customer: maskPhone(req, {
        ...c,
        ...stats,
        walletBalance: addBhd(num(c.walletPaid), num(c.walletBonus)),
        creditAvailable: c.creditEnabled && num(c.creditLimit) > 0 ? Math.max(0, num(c.creditLimit) - stats.outstanding) : null,
      }),
      packages,
    };
  });

  app.patch('/:id', { preHandler: perm('customers', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(customerSchema.partial().extend({ isActive: z.boolean().optional() }), req.body);
    const db = app.tdb(req);
    const before = await db.customer.findFirst({ where: { id } });
    if (!before) throw notFound('Customer');
    if (body.mobile && body.mobile !== before.mobile && (await db.customer.findFirst({ where: { mobile: body.mobile } }))) {
      throw new AppError(409, 'MOBILE_TAKEN', `A customer with mobile ${formatMobile(body.mobile)} already exists`);
    }
    const c = await db.customer.update({ where: { id }, data: body });
    if ((body.creditLimit !== undefined && num(before.creditLimit) !== body.creditLimit) || (body.creditEnabled !== undefined && before.creditEnabled !== body.creditEnabled)) {
      await audit(db, req, 'customer.credit_changed', 'customer', id, { creditEnabled: before.creditEnabled, creditLimit: num(before.creditLimit) }, { creditEnabled: c.creditEnabled, creditLimit: num(c.creditLimit) });
    }
    return { customer: c };
  });

  app.get('/:id/orders', { preHandler: canLookup }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { page } = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
    const db = app.tdb(req);
    const where = { customerId: id, orderNo: { not: null } };
    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        select: { id: true, orderNo: true, status: true, total: true, paidAmount: true, balanceDue: true, paymentState: true, onAccount: true, createdAt: true, pieceCount: true, express: true, deliveredAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      db.order.count({ where }),
    ]);
    return { orders, total };
  });

  app.get('/:id/wallet', { preHandler: anyPerm(['wallet', 'view'], ['customers', 'view']) }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const txns = await app.tdb(req).walletTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 300 });
    return { transactions: txns };
  });

  /** Unpaid credit-account invoices of a customer. */
  app.get('/:id/outstanding', { preHandler: canLookup }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const orders = await app.tdb(req).order.findMany({
      where: { customerId: id, balanceDue: { gt: 0 }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      select: { id: true, orderNo: true, createdAt: true, total: true, paidAmount: true, balanceDue: true, onAccount: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    return { orders };
  });

  /**
   * Record a payment from a (credit) customer against their invoices.
   * The amount is allocated to the selected invoices, oldest first.
   */
  const settleSchema = z.object({
    amount: zMoney.refine((v) => v > 0, 'Amount must be more than zero'),
    method: z.enum(['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER']),
    orderIds: z.array(z.string()).max(500).optional(),
    reference: zOptStr(100),
    note: zOptStr(300),
  });

  app.post('/:id/settle', { preHandler: anyPerm(['pos', 'create'], ['delivery', 'create']) }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(settleSchema, req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const result = await db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id } });
        if (!customer) throw notFound('Customer');
        const orders = await tx.order.findMany({
          where: {
            customerId: id,
            balanceDue: { gt: 0 },
            status: { notIn: ['CANCELLED', 'DRAFT'] },
            ...(body.orderIds?.length ? { id: { in: body.orderIds } } : {}),
          },
          orderBy: { createdAt: 'asc' },
        });
        const totalDue = orders.reduce((s, o) => s + toFils(num(o.balanceDue)), 0);
        if (toFils(body.amount) > totalDue) throw badRequest(`Amount is more than the outstanding balance (${fromFils(totalDue).toFixed(3)})`);
        const batchId = cryptoId();
        const receiptNo = await nextReceiptNo(tx, ctx.tenantId);
        const businessDate = await currentBusinessDate(tx);
        let left = toFils(body.amount);
        const allocations: { orderId: string; orderNo: number | null; amount: number }[] = [];
        for (const o of orders) {
          if (left <= 0) break;
          const take = Math.min(left, toFils(num(o.balanceDue)));
          await applyOrderPayments(tx, ctx, o, [{ method: body.method, amount: fromFils(take), reference: body.reference }], {
            batchId,
            receiptNo,
            businessDate,
            note: body.note ?? 'Account settlement',
          });
          await refreshPaymentState(tx, o.id);
          allocations.push({ orderId: o.id, orderNo: o.orderNo, amount: fromFils(take) });
          left -= take;
        }
        return { receiptNo, batchId, allocations };
      },
      { timeout: 30000 },
    );
    return result;
  });

  // ───── Export / import ─────

  async function exportTable(req: FastifyRequest): Promise<Table> {
    const q = parse(listSchema.extend({ format: z.enum(['xlsx', 'csv']).default('xlsx') }), req.query);
    const db = app.tdb(req);
    const customers = await db.customer.findMany({ where: buildWhere(req, q), orderBy: { name: 'asc' } });
    const stats = await withStats(req, customers.map((c) => c.id));
    const showPhone = hasCap(req.auth!.perms, 'viewCustomerPhone');
    return {
      name: 'Customers',
      columns: [
        { key: 'name', header: 'Name', width: 28 },
        ...(showPhone ? [{ key: 'mobile', header: 'Mobile', width: 16 }, { key: 'altPhone', header: 'Alt phone', width: 16 }] : []),
        { key: 'email', header: 'Email', width: 24 },
        { key: 'cpr', header: 'CPR' },
        { key: 'type', header: 'Type' },
        { key: 'area', header: 'Area' },
        { key: 'walletPaid', header: 'Paid balance', type: 'money' as const },
        { key: 'walletBonus', header: 'Bonus balance', type: 'money' as const },
        { key: 'creditLimit', header: 'Credit limit', type: 'money' as const },
        { key: 'outstanding', header: 'Outstanding', type: 'money' as const },
        { key: 'totalSpent', header: 'Total spent', type: 'money' as const },
        { key: 'orders', header: 'Orders', type: 'number' as const },
        { key: 'lastVisit', header: 'Last visit', width: 14 },
        { key: 'notes', header: 'Notes', width: 30 },
      ],
      rows: customers.map((c) => {
        const s = stats.get(c.id)!;
        return {
          ...c,
          mobile: formatMobile(c.mobile),
          area: c.addrArea,
          walletPaid: num(c.walletPaid),
          walletBonus: num(c.walletBonus),
          creditLimit: c.creditEnabled ? num(c.creditLimit) : null,
          ...s,
          lastVisit: s.lastVisit ? s.lastVisit.toISOString().slice(0, 10) : '',
        };
      }),
    };
  }

  app.get('/export', { preHandler: perm('customers', 'export') }, async (req, reply: FastifyReply) => {
    const { format } = parse(z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') }).passthrough(), req.query);
    const table = await exportTable(req);
    await audit(app.tdb(req), req, 'customers.exported', 'customer', null, null, { rows: table.rows.length, format });
    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="customers.csv"');
      return tableToCsv(table);
    }
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="customers.xlsx"');
    return tablesToXlsx([table]);
  });

  app.get('/import-template', { preHandler: perm('customers', 'create') }, async (_req, reply) => {
    const buf = await tablesToXlsx([
      {
        name: 'Customers',
        columns: [
          { key: 'name', header: 'Name', width: 28 },
          { key: 'mobile', header: 'Mobile', width: 16 },
          { key: 'alt', header: 'Alt Phone', width: 16 },
          { key: 'email', header: 'Email', width: 24 },
          { key: 'cpr', header: 'CPR' },
          { key: 'type', header: 'Type' },
          { key: 'area', header: 'Area' },
          { key: 'notes', header: 'Notes', width: 30 },
          { key: 'balance', header: 'Opening Balance', type: 'money' },
        ],
        rows: [{ name: 'Ahmed Ali', mobile: '33123456', type: 'Individual', area: 'Manama', balance: 0 }],
      },
    ]);
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
    return buf;
  });

  /** Bulk import customers from Excel/CSV (onboarding). Existing mobiles are skipped. */
  app.post('/import', { preHandler: perm('customers', 'create') }, async (req) => {
    const ctx = ctxOf(req);
    const part = await req.file();
    if (!part) throw badRequest('No file uploaded');
    const buf = await part.toBuffer();
    const rows = await readSheet(buf, part.mimetype, part.filename);
    if (rows.length > 20000) throw badRequest('Too many rows (max 20,000)');
    const db = app.tdb(req);
    const existing = new Set((await db.customer.findMany({ select: { mobile: true } })).map((c) => c.mobile));
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    let skipped = 0;
    const canAdjust = !!ctx.perms.modules.wallet?.includes('edit');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name || r.customername || r.customer || '').trim();
      const mobileRaw = r.mobile || r.phone || r.mobilenumber || r.phonenumber || '';
      if (!name || !mobileRaw) {
        errors.push({ row: i + 2, message: 'Name and mobile are required' });
        continue;
      }
      if (!isValidMobile(mobileRaw)) {
        errors.push({ row: i + 2, message: `Invalid mobile "${mobileRaw}"` });
        continue;
      }
      const mobile = normalizeMobile(mobileRaw);
      if (existing.has(mobile)) {
        skipped++;
        continue;
      }
      const type = /comp|corp|hotel|co\b/i.test(r.type ?? '') ? 'COMPANY' : 'INDIVIDUAL';
      const opening = Number(r.openingbalance || r.balance || 0);
      try {
        await db.$transaction(async (tx) => {
          const c = await tx.customer.create({
            data: {
              tenantId: ctx.tenantId,
              name: name.slice(0, 120),
              mobile,
              altPhone: (r.altphone || r.alternatephone || '').slice(0, 30) || null,
              email: (r.email || '').slice(0, 120) || null,
              cpr: (r.cpr || '').slice(0, 20) || null,
              type,
              addrArea: (r.area || '').slice(0, 80) || null,
              notes: (r.notes || '').slice(0, 1000) || null,
              createdById: ctx.userId,
            },
          });
          if (opening > 0 && canAdjust) {
            const amount = fromFils(toFils(opening));
            await tx.customer.update({ where: { id: c.id }, data: { walletPaid: amount } });
            await tx.walletTransaction.create({
              data: {
                tenantId: ctx.tenantId,
                customerId: c.id,
                type: 'ADJUSTMENT',
                paidDelta: amount,
                bonusDelta: 0,
                paidAfter: amount,
                bonusAfter: 0,
                reason: 'Opening balance (import)',
                createdById: ctx.userId,
              },
            });
          }
        });
        existing.add(mobile);
        created++;
      } catch (e) {
        errors.push({ row: i + 2, message: (e as Error).message.slice(0, 120) });
      }
    }
    await audit(db, req, 'customers.imported', 'customer', null, null, { created, skipped, errors: errors.length });
    return { created, skipped, errors: errors.slice(0, 200), total: rows.length };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSuperAdmin, scopedDb } from '../lib/context';
import { AppError, notFound } from '../lib/errors';
import { createSession } from '../lib/session';
import { subscriptionInfo } from '../lib/subscription';
import { parse, zOptStr } from '../lib/validate';
import { createTenant } from '../seed/tenant-setup';
import { signupSchema } from './onboarding.routes';

/**
 * NewMux super admin panel. Super admins manage tenants, plans and
 * subscriptions and see usage stats — but not tenant financial details,
 * unless the tenant owner has granted support access.
 */
export default async function platformRoutes(app: FastifyInstance) {
  const { prisma } = app;
  app.addHook('preHandler', async (req) => {
    requireSuperAdmin(req);
  });

  async function usage(tenantIds: string[]) {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [users, orders30, ordersAll, customers, lastSeen] = await Promise.all([
      prisma.user.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, isActive: true }, _count: true }),
      prisma.order.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, createdAt: { gte: since }, orderNo: { not: null } }, _count: true }),
      prisma.order.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, orderNo: { not: null } }, _count: true }),
      prisma.customer.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: true }),
      prisma.session.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _max: { lastSeenAt: true } }),
    ]);
    const map = <T extends { tenantId: string | null }>(rows: T[], f: (r: T) => unknown) =>
      Object.fromEntries(rows.map((r) => [r.tenantId, f(r)]));
    return {
      users: map(users, (r) => r._count),
      orders30: map(orders30, (r) => r._count),
      ordersAll: map(ordersAll, (r) => r._count),
      customers: map(customers, (r) => r._count),
      lastSeen: map(lastSeen, (r) => r._max.lastSeenAt),
    };
  }

  app.get('/stats', async () => {
    const tenants = await prisma.tenant.findMany({ select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, planId: true } });
    const byState: Record<string, number> = { TRIAL: 0, ACTIVE: 0, EXPIRED: 0, SUSPENDED: 0 };
    for (const t of tenants) byState[subscriptionInfo(t).state]++;
    const [users, orders30] = await Promise.all([
      prisma.user.count({ where: { tenantId: { not: null }, isActive: true } }),
      prisma.order.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) }, orderNo: { not: null } } }),
    ]);
    return { tenants: tenants.length, byState, users, orders30 };
  });

  app.get('/tenants', async (req) => {
    const q = parse(z.object({ q: z.string().optional() }), req.query);
    const tenants = await prisma.tenant.findMany({
      where: q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }, { phone: { contains: q.q } }] }
        : undefined,
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    const u = await usage(tenants.map((t) => t.id));
    return {
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        phone: t.phone,
        email: t.email,
        status: t.status,
        plan: t.plan ? { id: t.plan.id, name: t.plan.name, maxUsers: t.plan.maxUsers } : null,
        maxUsers: t.maxUsersOverride ?? t.plan?.maxUsers ?? null,
        trialEndsAt: t.trialEndsAt,
        subscriptionStart: t.subscriptionStart,
        currentPeriodEnd: t.currentPeriodEnd,
        subscriptionPaymentStatus: t.subscriptionPaymentStatus,
        subscription: subscriptionInfo(t),
        supportAccessUntil: t.supportAccessUntil,
        createdAt: t.createdAt,
        usage: {
          users: u.users[t.id] ?? 0,
          orders30: u.orders30[t.id] ?? 0,
          ordersAll: u.ordersAll[t.id] ?? 0,
          customers: u.customers[t.id] ?? 0,
          lastSeen: u.lastSeen[t.id] ?? null,
        },
      })),
    };
  });

  app.get('/tenants/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const t = await prisma.tenant.findUnique({ where: { id }, include: { plan: true } });
    if (!t) throw notFound('Tenant');
    const u = await usage([t.id]);
    const owners = await prisma.user.findMany({
      where: { tenantId: t.id, role: { key: 'OWNER' } },
      select: { id: true, name: true, username: true, email: true, lastLoginAt: true },
    });
    return {
      tenant: {
        ...t,
        settings: undefined,
        subscription: subscriptionInfo(t),
        owners,
        usage: {
          users: u.users[t.id] ?? 0,
          orders30: u.orders30[t.id] ?? 0,
          ordersAll: u.ordersAll[t.id] ?? 0,
          customers: u.customers[t.id] ?? 0,
          lastSeen: u.lastSeen[t.id] ?? null,
        },
      },
    };
  });

  app.post('/tenants', async (req) => {
    const body = parse(
      signupSchema.extend({ planCode: z.string().optional(), trialDays: z.number().int().min(0).max(365).optional() }),
      req.body,
    );
    if (await prisma.tenant.findUnique({ where: { slug: body.shop.slug } })) throw new AppError(409, 'SLUG_TAKEN', 'This shop code is already taken');
    if (body.owner.email && (await prisma.user.findUnique({ where: { email: body.owner.email } }))) {
      throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
    }
    const { tenant } = await createTenant(prisma, {
      slug: body.shop.slug,
      name: body.shop.name,
      crNumber: body.shop.crNumber,
      vatNumber: body.shop.vatNumber,
      address: body.shop.address,
      phone: body.shop.phone,
      email: body.shop.email ?? null,
      workingHours: body.shop.workingHours,
      template: body.template,
      planCode: body.planCode,
      trialDays: body.trialDays,
      owner: { name: body.owner.name, username: body.owner.username, email: body.owner.email ?? null, password: body.owner.password },
    });
    return { tenant: { id: tenant.id, slug: tenant.slug } };
  });

  const patchSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    planId: z.string().nullable().optional(),
    status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED']).optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    subscriptionStart: z.coerce.date().nullable().optional(),
    currentPeriodEnd: z.coerce.date().nullable().optional(),
    subscriptionPaymentStatus: z.enum(['PAID', 'UNPAID', 'OVERDUE']).optional(),
    maxUsersOverride: z.number().int().min(1).max(500).nullable().optional(),
    adminNotes: zOptStr(2000),
  });

  app.patch('/tenants/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(patchSchema, req.body);
    const before = await prisma.tenant.findUnique({ where: { id } });
    if (!before) throw notFound('Tenant');
    const t = await prisma.tenant.update({ where: { id }, data: body });
    if (body.status === 'SUSPENDED') await prisma.session.deleteMany({ where: { tenantId: id, supportMode: false } });
    await scopedDb(prisma, id).auditLog.create({
      data: {
        tenantId: id,
        userId: req.auth!.user.id,
        userName: `${req.auth!.user.name} (NewMux)`,
        action: 'platform.tenant_updated',
        entity: 'tenant',
        entityId: id,
        oldValue: { status: before.status, planId: before.planId, currentPeriodEnd: before.currentPeriodEnd, trialEndsAt: before.trialEndsAt },
        newValue: JSON.parse(JSON.stringify(body)),
        ip: req.ip,
      },
    });
    return { tenant: { id: t.id, status: t.status } };
  });

  /** Record a subscription payment: extend the period by N months and activate. */
  app.post('/tenants/:id/renew', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { months } = parse(z.object({ months: z.number().int().min(1).max(36) }), req.body);
    const t = await prisma.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Tenant');
    const now = new Date();
    const from = t.currentPeriodEnd && t.currentPeriodEnd > now ? t.currentPeriodEnd : now;
    const end = new Date(from);
    end.setMonth(end.getMonth() + months);
    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        subscriptionStart: t.subscriptionStart ?? now,
        currentPeriodEnd: end,
        subscriptionPaymentStatus: 'PAID',
      },
    });
    return { tenant: { id: updated.id, currentPeriodEnd: updated.currentPeriodEnd } };
  });

  /** Enter a tenant as support — only while the owner has granted support access. */
  app.post('/tenants/:id/support-session', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const t = await prisma.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Tenant');
    if (!t.supportAccessUntil || t.supportAccessUntil < new Date()) {
      throw new AppError(403, 'NO_SUPPORT_ACCESS', 'The shop owner has not granted support access');
    }
    const admin = requireSuperAdmin(req);
    await createSession(prisma, app.config, req, reply, admin.user.id, t.id, { supportMode: true, expiresAt: t.supportAccessUntil });
    await scopedDb(prisma, id).auditLog.create({
      data: { tenantId: id, userId: admin.user.id, userName: `${admin.user.name} (NewMux)`, action: 'platform.support_session', entity: 'tenant', entityId: id, ip: req.ip },
    });
    return { ok: true };
  });

  // ───── Plans ─────
  const planSchema = z.object({
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,30}$/),
    name: z.string().trim().min(2).max(60),
    priceMonthly: z.number().min(0),
    maxUsers: z.number().int().min(1).max(500),
    features: z.object({ customPermissions: z.boolean(), dataExport: z.boolean() }),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  });

  app.get('/plans', async () => {
    const plans = await prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { tenants: true } } } });
    return { plans };
  });
  app.post('/plans', async (req) => {
    const body = parse(planSchema, req.body);
    return { plan: await prisma.plan.create({ data: body }) };
  });
  app.patch('/plans/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(planSchema.partial(), req.body);
    return { plan: await prisma.plan.update({ where: { id }, data: body }) };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_ROLE_PERMISSIONS, parseSettings, sanitizePermissions, tenantSettingsSchema, type RoleKey } from '@laundry/shared';
import { audit, perm, requireTenant } from '../lib/context';
import { AppError, forbidden, notFound } from '../lib/errors';
import { IMAGE_TYPES, saveUpload } from '../lib/files';
import { maxUsersFor, planFeatures, subscriptionInfo } from '../lib/subscription';
import { parse, zOptStr } from '../lib/validate';
import { workingHoursSchema } from './onboarding.routes';

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: perm('settings', 'view') }, async (req) => {
    const a = requireTenant(req);
    const t = await app.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenant.id }, include: { plan: true } });
    return {
      shop: {
        name: t.name,
        slug: t.slug,
        crNumber: t.crNumber,
        vatNumber: t.vatNumber,
        address: t.address,
        phone: t.phone,
        email: t.email,
        logoFileId: t.logoFileId,
        workingHours: t.workingHours,
      },
      settings: parseSettings(t.settings),
      supportAccessUntil: t.supportAccessUntil,
    };
  });

  const shopSchema = z.object({
    name: z.string().trim().min(2).max(120),
    crNumber: zOptStr(40),
    vatNumber: zOptStr(40),
    address: zOptStr(400),
    phone: zOptStr(40),
    email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
    workingHours: workingHoursSchema,
  });

  app.put('/shop', { preHandler: perm('settings', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(shopSchema, req.body);
    const before = await app.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenant.id } });
    await app.prisma.tenant.update({ where: { id: a.tenant.id }, data: { ...body, workingHours: body.workingHours as object } });
    if (before.vatNumber !== body.vatNumber || before.name !== body.name) {
      await audit(app.tdb(req), req, 'settings.shop_changed', 'tenant', a.tenant.id, { name: before.name, vatNumber: before.vatNumber }, { name: body.name, vatNumber: body.vatNumber });
    }
    return { ok: true };
  });

  app.put('/preferences', { preHandler: perm('settings', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(tenantSettingsSchema, req.body);
    const before = parseSettings(a.tenant.settings);
    await app.prisma.tenant.update({ where: { id: a.tenant.id }, data: { settings: body as object } });
    const watched = ['vatRate', 'pricesIncludeVat', 'expressSurchargeType', 'expressSurchargeValue'] as const;
    if (watched.some((k) => before[k] !== body[k])) {
      await audit(
        app.tdb(req),
        req,
        'settings.pricing_changed',
        'tenant',
        a.tenant.id,
        Object.fromEntries(watched.map((k) => [k, before[k]])),
        Object.fromEntries(watched.map((k) => [k, body[k]])),
      );
    }
    return { settings: body };
  });

  app.post('/logo', { preHandler: perm('settings', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const { file } = await saveUpload(app, req, 'LOGO', IMAGE_TYPES);
    await app.prisma.tenant.update({ where: { id: a.tenant.id }, data: { logoFileId: file.id } });
    return { logoFileId: file.id };
  });

  app.delete('/logo', { preHandler: perm('settings', 'edit') }, async (req) => {
    const a = requireTenant(req);
    await app.prisma.tenant.update({ where: { id: a.tenant.id }, data: { logoFileId: null } });
    return { ok: true };
  });

  /** Owner grants NewMux support access to the account for N days (0 = revoke). */
  app.post('/support-access', async (req) => {
    const a = requireTenant(req);
    if (a.roleKey !== 'OWNER' || a.supportMode) throw forbidden('Only the owner can grant support access');
    const { days } = parse(z.object({ days: z.number().int().min(0).max(30) }), req.body);
    const until = days > 0 ? new Date(Date.now() + days * 86400_000) : null;
    await app.prisma.tenant.update({ where: { id: a.tenant.id }, data: { supportAccessUntil: until } });
    if (!until) await app.prisma.session.deleteMany({ where: { tenantId: a.tenant.id, supportMode: true } });
    await audit(app.tdb(req), req, until ? 'settings.support_access_granted' : 'settings.support_access_revoked', 'tenant', a.tenant.id, null, { until });
    return { supportAccessUntil: until };
  });

  app.get('/subscription', async (req) => {
    const a = requireTenant(req);
    const t = await app.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenant.id }, include: { plan: true } });
    const users = await app.tdb(req).user.count({ where: { isActive: true } });
    return {
      plan: t.plan ? { name: t.plan.name, priceMonthly: t.plan.priceMonthly, maxUsers: t.plan.maxUsers } : null,
      features: planFeatures(t.plan),
      status: t.status,
      trialEndsAt: t.trialEndsAt,
      subscriptionStart: t.subscriptionStart,
      currentPeriodEnd: t.currentPeriodEnd,
      paymentStatus: t.subscriptionPaymentStatus,
      subscription: subscriptionInfo(t),
      users: { used: users, max: maxUsersFor(t, t.plan) },
    };
  });

  // ───── Roles & permission matrix ─────
  app.get('/roles', { preHandler: perm('users', 'view') }, async (req) => {
    const roles = await app.tdb(req).role.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { users: true } } } });
    const a = requireTenant(req);
    return {
      roles: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        isSystem: r.isSystem,
        users: r._count.users,
        permissions: r.key === 'OWNER' ? DEFAULT_ROLE_PERMISSIONS.OWNER : sanitizePermissions(r.permissions),
        editable: r.key !== 'OWNER',
      })),
      canCustomize: planFeatures(a.tenant.plan).customPermissions,
    };
  });

  app.put('/roles/:id', { preHandler: perm('users', 'edit') }, async (req) => {
    const a = requireTenant(req);
    if (a.roleKey !== 'OWNER' && !a.supportMode) throw forbidden('Only the owner can change role permissions');
    if (!planFeatures(a.tenant.plan).customPermissions) {
      throw new AppError(402, 'PLAN_FEATURE', 'Editing role permissions is an add-on (Advanced permissions). Upgrade your plan to use it.');
    }
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), permissions: z.unknown() }), req.body);
    const db = app.tdb(req);
    const role = await db.role.findFirst({ where: { id } });
    if (!role) throw notFound('Role');
    if (role.key === 'OWNER') throw forbidden('The owner role always has full access');
    const permissions = sanitizePermissions(body.permissions);
    await db.role.update({ where: { id }, data: { permissions: permissions as object, name: body.name ?? role.name } });
    await audit(db, req, 'role.permissions_changed', 'role', id, role.permissions, permissions);
    return { ok: true };
  });

  app.post('/roles/:id/reset', { preHandler: perm('users', 'edit') }, async (req) => {
    const a = requireTenant(req);
    if (a.roleKey !== 'OWNER' && !a.supportMode) throw forbidden('Only the owner can change role permissions');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const role = await db.role.findFirst({ where: { id } });
    if (!role) throw notFound('Role');
    const def = DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey];
    if (!def) throw new AppError(400, 'NO_DEFAULT', 'This role has no default permissions');
    await db.role.update({ where: { id }, data: { permissions: def as object } });
    await audit(db, req, 'role.permissions_reset', 'role', id, role.permissions, def);
    return { ok: true };
  });
}

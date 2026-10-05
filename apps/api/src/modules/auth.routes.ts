import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can } from '@laundry/shared';
import { DEVICE_COOKIE, SESSION_COOKIE, audit, requireAuth, scopedDb } from '../lib/context';
import { createSession as createSessionLib, trustDevice as trustDeviceLib } from '../lib/session';
import { hashPassword, sha256, verifyPassword } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { subscriptionInfo } from '../lib/subscription';
import { parse } from '../lib/validate';
import { parseSettings } from '@laundry/shared';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export default async function authRoutes(app: FastifyInstance) {
  const { prisma, config } = app;

  const createSession = (
    req: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    tenantId: string | null,
  ) => createSessionLib(prisma, config, req, reply, userId, tenantId);

  const trustDevice = (reply: FastifyReply, req: FastifyRequest, tenantId: string) =>
    trustDeviceLib(prisma, config, req, reply, tenantId);

  async function deviceTenant(req: FastifyRequest): Promise<string | null> {
    const token = req.cookies[DEVICE_COOKIE];
    if (!token) return null;
    const d = await prisma.device.findUnique({ where: { tokenHash: sha256(token) } });
    if (!d) return null;
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    return d.tenantId;
  }

  const loginSchema = z.object({
    shopCode: z.string().trim().toLowerCase().max(60).optional().nullable(),
    identifier: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(200),
  });

  app.post('/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const ident = body.identifier.toLowerCase();
    let user;
    if (ident.includes('@')) {
      user = await prisma.user.findUnique({ where: { email: ident }, include: { tenant: true } });
    } else {
      if (!body.shopCode) throw new AppError(400, 'SHOP_REQUIRED', 'Enter your shop code to sign in with a username');
      const tenant = await prisma.tenant.findUnique({ where: { slug: body.shopCode } });
      if (tenant) {
        user = await prisma.user.findUnique({
          where: { tenantId_username: { tenantId: tenant.id, username: ident } },
          include: { tenant: true },
        });
      }
    }
    const invalid = new AppError(401, 'INVALID_LOGIN', 'Incorrect sign-in details');
    if (!user || !user.isActive) throw invalid;
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, 'LOCKED', 'Too many failed attempts. Try again in a few minutes.');
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      throw invalid;
    }
    if (user.tenant) {
      const sub = subscriptionInfo(user.tenant);
      if (sub.state === 'SUSPENDED') {
        throw new AppError(403, 'TENANT_SUSPENDED', 'This account is suspended. Please contact NewMux support.');
      }
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await createSession(req, reply, user.id, user.tenantId);
    if (user.tenantId) {
      await trustDevice(reply, req, user.tenantId);
      await scopedDb(prisma, user.tenantId).auditLog.create({
        data: { tenantId: user.tenantId, userId: user.id, userName: user.name, action: 'auth.login', entity: 'user', entityId: user.id, ip: req.ip },
      });
    }
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) await prisma.session.delete({ where: { id: req.auth.sessionId } }).catch(() => undefined);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Users on this counter device that can switch in with a PIN. */
  app.get('/pin-users', async (req) => {
    const tenantId = await deviceTenant(req);
    if (!tenantId) return { tenant: null, users: [] };
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true, logoFileId: true } });
    const users = await prisma.user.findMany({
      where: { tenantId, isActive: true, pinHash: { not: null } },
      select: { id: true, name: true, role: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return { tenant, users: users.map((u) => ({ id: u.id, name: u.name, role: u.role?.name ?? '' })) };
  });

  const pinSchema = z.object({ userId: z.string().min(1), pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits') });

  app.post('/pin', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(pinSchema, req.body);
    const tenantId = await deviceTenant(req);
    if (!tenantId) throw new AppError(401, 'DEVICE_NOT_TRUSTED', 'Sign in with a password on this device first');
    const user = await prisma.user.findFirst({ where: { id: body.userId, tenantId, isActive: true }, include: { tenant: true } });
    if (!user || !user.pinHash) throw new AppError(401, 'INVALID_PIN', 'Incorrect PIN');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, 'LOCKED', 'Too many failed attempts. Try again in a few minutes.');
    }
    if (user.tenant && subscriptionInfo(user.tenant).state === 'SUSPENDED') {
      throw new AppError(403, 'TENANT_SUSPENDED', 'This account is suspended. Please contact NewMux support.');
    }
    const ok = await verifyPassword(body.pin, user.pinHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      throw new AppError(401, 'INVALID_PIN', 'Incorrect PIN');
    }
    if (req.auth) await prisma.session.delete({ where: { id: req.auth.sessionId } }).catch(() => undefined);
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await createSession(req, reply, user.id, tenantId);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const a = req.auth;
    if (!a) return { user: null };
    const t = a.tenant;
    return {
      user: a.user,
      supportMode: a.supportMode,
      role: a.roleKey ? { key: a.roleKey, name: a.roleName } : null,
      permissions: a.perms,
      tenant: t
        ? {
            id: t.id,
            slug: t.slug,
            name: t.name,
            logoFileId: t.logoFileId,
            vatNumber: t.vatNumber,
            crNumber: t.crNumber,
            address: t.address,
            phone: t.phone,
            workingHours: t.workingHours,
            settings: parseSettings(t.settings),
            plan: t.plan ? { name: t.plan.name, code: t.plan.code } : null,
            features: a.features,
          }
        : null,
      subscription: a.subscription,
      canCheckIn: !!a.user.employeeId,
      isOwner: a.roleKey === 'OWNER',
      reportsAllowed: can(a.perms, 'reports'),
    };
  });

  const pwSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });
  app.post('/change-password', async (req) => {
    const a = requireAuth(req);
    const body = parse(pwSchema, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
    await prisma.session.deleteMany({ where: { userId: user.id, id: { not: a.sessionId } } });
    return { ok: true };
  });

  const setPinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits').nullable() });
  app.post('/pin/set', async (req) => {
    const a = requireAuth(req);
    if (!a.tenant || a.supportMode) throw new AppError(400, 'NOT_ALLOWED', 'PIN is only for shop users');
    const body = parse(setPinSchema, req.body);
    await prisma.user.update({ where: { id: a.user.id }, data: { pinHash: body.pin ? await hashPassword(body.pin) : null } });
    if (req.auth?.tenant) await audit(scopedDb(prisma, a.tenant.id), req, 'user.pin_changed', 'user', a.user.id);
    return { ok: true };
  });
}

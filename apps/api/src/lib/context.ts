import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Plan, PrismaClient, Tenant } from '@prisma/client';
import {
  DEFAULT_ROLE_PERMISSIONS,
  can,
  effectivePermissions,
  hasCap,
  parseSettings,
  type Action,
  type Cap,
  type Module,
  type Permissions,
  type TenantSettings,
} from '@laundry/shared';
import { sha256 } from './crypto';
import { AppError, forbidden } from './errors';
import { planFeatures, subscriptionInfo, type PlanFeatures, type SubscriptionInfo } from './subscription';
import { tenantDb, type TenantDb, type TenantTx } from './tenant-db';

export const SESSION_COOKIE = 'lms_sid';
export const DEVICE_COOKIE = 'lms_did';
const PLATFORM_IDLE_MINUTES = 120;

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  isSuperAdmin: boolean;
  employeeId: string | null;
}

export interface AuthContext {
  sessionId: string;
  supportMode: boolean;
  user: AuthUser;
  tenant: (Tenant & { plan: Plan | null }) | null;
  settings: TenantSettings | null;
  roleKey: string | null;
  roleName: string | null;
  perms: Permissions;
  subscription: SubscriptionInfo | null;
  features: PlanFeatures | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const dbCache = new Map<string, TenantDb>();
export function scopedDb(prisma: PrismaClient, tenantId: string): TenantDb {
  let db = dbCache.get(tenantId);
  if (!db) {
    if (dbCache.size > 1000) dbCache.clear();
    db = tenantDb(prisma, tenantId);
    dbCache.set(tenantId, db);
  }
  return db;
}

/** Resolve the session cookie into an auth context (or null). */
export async function loadAuth(prisma: PrismaClient, req: FastifyRequest): Promise<AuthContext | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { role: true } }, tenant: { include: { plan: true } } },
  });
  if (!session) return null;
  const now = new Date();
  const user = session.user;
  if (session.expiresAt < now || !user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const tenant = session.tenant;
  const settings = tenant ? parseSettings(tenant.settings) : null;
  const idleMinutes = settings?.sessionTimeoutMinutes ?? PLATFORM_IDLE_MINUTES;
  if (now.getTime() - session.lastSeenAt.getTime() > idleMinutes * 60_000) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => undefined);
  }

  const subscription = tenant ? subscriptionInfo(tenant, now) : null;
  if (tenant && subscription?.state === 'SUSPENDED' && !session.supportMode) return null;

  let perms: Permissions;
  let roleKey: string | null = null;
  let roleName: string | null = null;
  if (session.supportMode) {
    perms = DEFAULT_ROLE_PERMISSIONS.OWNER;
    roleKey = 'OWNER';
    roleName = 'NewMux Support';
  } else if (tenant && user.role) {
    roleKey = user.role.key;
    roleName = user.role.name;
    perms = effectivePermissions(user.role.key, user.role.permissions);
  } else {
    perms = { modules: {}, caps: {}, maxDiscountPercent: 0 };
  }

  return {
    sessionId: session.id,
    supportMode: session.supportMode,
    user: {
      id: user.id,
      name: session.supportMode ? `${user.name} (NewMux support)` : user.name,
      username: user.username,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      employeeId: user.employeeId,
    },
    tenant,
    settings,
    roleKey,
    roleName,
    perms,
    subscription,
    features: tenant ? planFeatures(tenant.plan) : null,
  };
}

// ───────────── Guards ─────────────

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  return req.auth;
}

export interface TenantAuth extends AuthContext {
  tenant: Tenant & { plan: Plan | null };
  settings: TenantSettings;
}

export function requireTenant(req: FastifyRequest): TenantAuth {
  const a = requireAuth(req);
  if (!a.tenant || !a.settings) throw new AppError(403, 'NO_TENANT', 'This action requires a shop account');
  return a as TenantAuth;
}

export function requireSuperAdmin(req: FastifyRequest): AuthContext {
  const a = requireAuth(req);
  if (!a.user.isSuperAdmin || a.tenant) throw forbidden('Super admin only');
  return a;
}

/** preHandler factory: require a module permission. */
export function perm(module: Module, action: Action = 'view') {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const a = requireTenant(req);
    if (!can(a.perms, module, action)) throw forbidden();
  };
}

/** preHandler factory: require any one of several module permissions. */
export function anyPerm(...pairs: [Module, Action][]) {
  return async (req: FastifyRequest) => {
    const a = requireTenant(req);
    if (!pairs.some(([m, act]) => can(a.perms, m, act))) throw forbidden();
  };
}

export function assertCan(req: FastifyRequest, module: Module, action: Action = 'view'): void {
  const a = requireTenant(req);
  if (!can(a.perms, module, action)) throw forbidden();
}

export function userCan(req: FastifyRequest, module: Module, action: Action = 'view'): boolean {
  return !!req.auth && can(req.auth.perms, module, action);
}

export function userHasCap(req: FastifyRequest, cap: Cap): boolean {
  return !!req.auth && hasCap(req.auth.perms, cap);
}

// ───────────── Audit ─────────────

type AuditDb = TenantDb | TenantTx;

/** Write a sensitive action to the tenant audit log (user, time, old & new value). */
export async function audit(
  db: AuditDb,
  req: FastifyRequest,
  action: string,
  entity: string,
  entityId: string | null,
  oldValue?: unknown,
  newValue?: unknown,
  note?: string | null,
): Promise<void> {
  const a = req.auth;
  await db.auditLog.create({
    data: {
      tenantId: a?.tenant?.id ?? null,
      userId: a?.user.id ?? null,
      userName: a?.user.name ?? null,
      action,
      entity,
      entityId,
      oldValue: oldValue === undefined ? undefined : (JSON.parse(JSON.stringify(oldValue)) as object),
      newValue: newValue === undefined ? undefined : (JSON.parse(JSON.stringify(newValue)) as object),
      note: note ?? null,
      ip: req.ip,
    },
  });
}

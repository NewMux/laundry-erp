import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_WORKING_HOURS,
  ROLE_KEYS,
  SALARIES_CATEGORY,
  tenantSettingsSchema,
  type WorkingHours,
} from '@laundry/shared';
import { hashPassword } from '../lib/crypto';
import { tenantDb } from '../lib/tenant-db';
import { DEFAULT_PACKAGES, DEFAULT_PLANS, PRICE_TEMPLATES, SERVICES, TRIAL_DAYS, type PriceTemplateKey } from './templates';

const ROLE_NAMES: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier', WORKER: 'Worker' };

export async function ensurePlans(prisma: PrismaClient) {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, name: p.name, priceMonthly: p.priceMonthly, maxUsers: p.maxUsers, features: p.features, sortOrder: p.sortOrder },
    });
  }
}

export async function ensureSuperAdmin(prisma: PrismaClient, email?: string, password?: string) {
  const existing = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  if (existing || !email || !password) return existing;
  return prisma.user.create({
    data: {
      tenantId: null,
      isSuperAdmin: true,
      name: 'NewMux Admin',
      username: email.toLowerCase(),
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
    },
  });
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  crNumber?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  workingHours?: WorkingHours;
  template?: PriceTemplateKey;
  planCode?: string;
  trialDays?: number;
  owner: { name: string; username: string; email?: string | null; password: string; pin?: string | null };
  settings?: Record<string, unknown>;
}

/** Create a new laundry account with roles, owner, expense categories and a starter price list. */
export async function createTenant(prisma: PrismaClient, input: CreateTenantInput) {
  const plan = await prisma.plan.findUnique({ where: { code: input.planCode ?? 'business' } });
  const trialDays = input.trialDays ?? TRIAL_DAYS;
  const settings = tenantSettingsSchema.parse(input.settings ?? {});

  const tenant = await prisma.tenant.create({
    data: {
      slug: input.slug,
      name: input.name,
      crNumber: input.crNumber ?? null,
      vatNumber: input.vatNumber ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      workingHours: (input.workingHours ?? DEFAULT_WORKING_HOURS) as object,
      settings: settings as object,
      status: 'TRIAL',
      planId: plan?.id ?? null,
      trialEndsAt: new Date(Date.now() + trialDays * 86400_000),
    },
  });
  return { tenant, ...(await ensureTenantSetup(prisma, tenant.id, input)) };
}

/**
 * Roles, owner, expense categories and the price list of an existing tenant.
 * Creates only what is missing, so a setup that stopped half way (e.g. a
 * dropped connection during the demo seed) can be completed by running it again.
 */
export async function ensureTenantSetup(prisma: PrismaClient, tenantId: string, input: Pick<CreateTenantInput, 'owner' | 'template'>) {
  const db = tenantDb(prisma, tenantId);

  const roles: Record<string, string> = {};
  const existingRoles = await db.role.findMany();
  for (const key of ROLE_KEYS) {
    const r =
      existingRoles.find((x) => x.key === key) ??
      (await db.role.create({
        data: { tenantId, key, name: ROLE_NAMES[key], permissions: DEFAULT_ROLE_PERMISSIONS[key] as object, isSystem: true },
      }));
    roles[key] = r.id;
  }

  const username = input.owner.username.toLowerCase();
  const owner =
    (await db.user.findFirst({ where: { username } })) ??
    (await db.user.create({
      data: {
        tenantId,
        name: input.owner.name,
        username,
        email: input.owner.email ? input.owner.email.toLowerCase() : null,
        passwordHash: await hashPassword(input.owner.password),
        pinHash: input.owner.pin ? await hashPassword(input.owner.pin) : null,
        roleId: roles.OWNER,
      },
    }));

  await db.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({ tenantId, name, isSystem: name === SALARIES_CATEGORY, sortOrder: i })),
    skipDuplicates: true,
  });

  await applyPriceTemplate(prisma, tenantId, input.template ?? 'standard');
  return { owner, roles };
}

export async function applyPriceTemplate(prisma: PrismaClient, tenantId: string, template: PriceTemplateKey) {
  const db = tenantDb(prisma, tenantId);
  // Skip rows that already exist, so an interrupted setup can be completed (see ensureTenantSetup).
  const [existingServices, existingItems, existingPackages] = await Promise.all([
    db.serviceType.findMany({ select: { id: true, name: true } }),
    db.itemType.findMany({ select: { id: true, imageKey: true } }),
    db.package.findMany({ select: { name: true } }),
  ]);
  const services: Record<string, string> = {};
  let i = 0;
  for (const s of SERVICES) {
    const found = existingServices.find((x) => x.name === s.name);
    if (found) {
      services[s.key] = found.id;
      i++;
      continue;
    }
    const created = await db.serviceType.create({
      data: {
        tenantId,
        name: s.name,
        iconKey: s.iconKey,
        requiresProcessing: s.requiresProcessing,
        requiresIroning: s.requiresIroning,
        turnaroundHours: s.turnaroundHours,
        expressTurnaroundHours: s.expressTurnaroundHours,
        sortOrder: i++,
      },
    });
    services[s.key] = created.id;
  }
  const items: Record<string, string> = {};
  let order = 0;
  for (const it of PRICE_TEMPLATES[template].items) {
    const item =
      existingItems.find((x) => x.imageKey === it.imageKey) ??
      (await db.itemType.create({
        data: { tenantId, name: it.name, imageKey: it.imageKey, category: it.category, unit: it.unit ?? 'PIECE', sortOrder: order },
      }));
    order++;
    items[it.imageKey] = item.id;
    const rows = Object.entries(it.prices)
      .filter(([, price]) => price !== null && price !== undefined)
      .map(([key, price]) => ({ tenantId, itemTypeId: item.id, serviceTypeId: services[key], price: price as number }));
    if (rows.length) await db.priceListEntry.createMany({ data: rows, skipDuplicates: true });
  }
  if (template !== 'empty') {
    for (const p of DEFAULT_PACKAGES) {
      if (p.kind === 'ITEMS' && (!items[p.itemKey] || !services[p.serviceKey])) continue;
      if (existingPackages.some((x) => x.name === p.name)) continue;
      await db.package.create({
        data: {
          tenantId,
          name: p.name,
          kind: p.kind,
          price: p.price,
          creditValue: p.kind === 'CREDIT' ? p.creditValue : null,
          itemCount: p.kind === 'ITEMS' ? p.itemCount : null,
          itemTypeId: p.kind === 'ITEMS' ? items[p.itemKey] : null,
          serviceTypeId: p.kind === 'ITEMS' ? services[p.serviceKey] : null,
          validityDays: p.validityDays,
          sortOrder: p.sortOrder,
        },
      });
    }
  }
  return { services, items };
}

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
  const db = tenantDb(prisma, tenant.id);

  const roles: Record<string, string> = {};
  for (const key of ROLE_KEYS) {
    const r = await db.role.create({
      data: { tenantId: tenant.id, key, name: ROLE_NAMES[key], permissions: DEFAULT_ROLE_PERMISSIONS[key] as object, isSystem: true },
    });
    roles[key] = r.id;
  }

  const owner = await db.user.create({
    data: {
      tenantId: tenant.id,
      name: input.owner.name,
      username: input.owner.username.toLowerCase(),
      email: input.owner.email ? input.owner.email.toLowerCase() : null,
      passwordHash: await hashPassword(input.owner.password),
      pinHash: input.owner.pin ? await hashPassword(input.owner.pin) : null,
      roleId: roles.OWNER,
    },
  });

  await db.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({ tenantId: tenant.id, name, isSystem: name === SALARIES_CATEGORY, sortOrder: i })),
  });

  await applyPriceTemplate(prisma, tenant.id, input.template ?? 'standard');
  return { tenant, owner, roles };
}

export async function applyPriceTemplate(prisma: PrismaClient, tenantId: string, template: PriceTemplateKey) {
  const db = tenantDb(prisma, tenantId);
  const services: Record<string, string> = {};
  let i = 0;
  for (const s of SERVICES) {
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
    const item = await db.itemType.create({
      data: { tenantId, name: it.name, imageKey: it.imageKey, category: it.category, unit: it.unit ?? 'PIECE', sortOrder: order++ },
    });
    items[it.imageKey] = item.id;
    const rows = Object.entries(it.prices)
      .filter(([, price]) => price !== null && price !== undefined)
      .map(([key, price]) => ({ tenantId, itemTypeId: item.id, serviceTypeId: services[key], price: price as number }));
    if (rows.length) await db.priceListEntry.createMany({ data: rows });
  }
  if (template !== 'empty') {
    for (const p of DEFAULT_PACKAGES) {
      if (p.kind === 'ITEMS' && (!items[p.itemKey] || !services[p.serviceKey])) continue;
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

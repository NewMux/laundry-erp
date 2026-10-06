import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hasCap } from '@laundry/shared';
import { anyPerm, audit, perm, requireTenant } from '../lib/context';
import { AppError, notFound } from '../lib/errors';
import { IMAGE_TYPES, saveUpload } from '../lib/files';
import { num } from '../lib/prisma';
import { parse, zMoney, zOptStr } from '../lib/validate';

export default async function catalogRoutes(app: FastifyInstance) {
  /** Everything the POS grid needs: active items, services and prices. */
  app.get('/pos', { preHandler: anyPerm(['pos', 'view'], ['catalog', 'view']) }, async (req) => {
    const a = requireTenant(req);
    const db = app.tdb(req);
    const [items, services, prices, packages] = await Promise.all([
      db.itemType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      db.serviceType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      db.priceListEntry.findMany({ where: { isActive: true } }),
      db.package.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
    ]);
    const showPrices = hasCap(a.perms, 'viewPrices');
    return {
      items: items.map((i) => ({ id: i.id, name: i.name, imageKey: i.imageKey, imageFileId: i.imageFileId, category: i.category, unit: i.unit })),
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        iconKey: s.iconKey,
        requiresProcessing: s.requiresProcessing,
        requiresIroning: s.requiresIroning,
        turnaroundHours: s.turnaroundHours,
        expressTurnaroundHours: s.expressTurnaroundHours,
      })),
      prices: prices.map((p) => ({
        itemTypeId: p.itemTypeId,
        serviceTypeId: p.serviceTypeId,
        price: showPrices ? num(p.price) : null,
        expressPrice: showPrices && p.expressPrice !== null ? num(p.expressPrice) : null,
      })),
      packages,
    };
  });

  /** Full price list management view (incl. inactive). */
  app.get('/', { preHandler: perm('catalog', 'view') }, async (req) => {
    const db = app.tdb(req);
    const [items, services, prices] = await Promise.all([
      db.itemType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      db.serviceType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      db.priceListEntry.findMany(),
    ]);
    return { items, services, prices };
  });

  const itemSchema = z.object({
    name: z.string().trim().min(1).max(80),
    imageKey: zOptStr(40),
    category: zOptStr(40),
    unit: z.enum(['PIECE', 'SQM']).default('PIECE'),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().optional(),
  });

  app.post('/items', { preHandler: perm('catalog', 'create') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(itemSchema, req.body);
    const db = app.tdb(req);
    const max = await db.itemType.aggregate({ _max: { sortOrder: true } });
    const item = await db.itemType.create({
      data: { ...body, tenantId: a.tenant.id, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1 },
    });
    return { item };
  });

  app.patch('/items/:id', { preHandler: perm('catalog', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(itemSchema.partial().extend({ imageFileId: z.string().nullish() }), req.body);
    const db = app.tdb(req);
    if (!(await db.itemType.findFirst({ where: { id } }))) throw notFound('Item');
    return { item: await db.itemType.update({ where: { id }, data: body }) };
  });

  app.post('/items/:id/image', { preHandler: perm('catalog', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    if (!(await db.itemType.findFirst({ where: { id } }))) throw notFound('Item');
    const { file } = await saveUpload(app, req, 'ITEM_IMAGE', IMAGE_TYPES);
    return { item: await db.itemType.update({ where: { id }, data: { imageFileId: file.id } }) };
  });

  app.delete('/items/:id', { preHandler: perm('catalog', 'delete') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const db = app.tdb(req);
    const used = await db.orderItem.count({ where: { itemTypeId: id } });
    if (used > 0) {
      await db.itemType.update({ where: { id }, data: { isActive: false } });
      return { deactivated: true };
    }
    await db.itemType.delete({ where: { id } });
    return { deleted: true };
  });

  app.put('/items/order', { preHandler: perm('catalog', 'edit') }, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(500) }), req.body);
    const db = app.tdb(req);
    await db.$transaction(ids.map((id, i) => db.itemType.update({ where: { id }, data: { sortOrder: i } })));
    return { ok: true };
  });

  const serviceSchema = z.object({
    name: z.string().trim().min(1).max(60),
    iconKey: zOptStr(40),
    requiresProcessing: z.boolean().default(true),
    requiresIroning: z.boolean().default(true),
    turnaroundHours: z.number().int().min(0).max(24 * 60).default(48),
    expressTurnaroundHours: z.number().int().min(0).max(24 * 60).default(24),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().optional(),
  });

  app.post('/services', { preHandler: perm('catalog', 'create') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(serviceSchema, req.body);
    const db = app.tdb(req);
    const max = await db.serviceType.aggregate({ _max: { sortOrder: true } });
    return { service: await db.serviceType.create({ data: { ...body, tenantId: a.tenant.id, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } }) };
  });

  app.patch('/services/:id', { preHandler: perm('catalog', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(serviceSchema.partial(), req.body);
    const db = app.tdb(req);
    if (!(await db.serviceType.findFirst({ where: { id } }))) throw notFound('Service');
    return { service: await db.serviceType.update({ where: { id }, data: body }) };
  });

  /** Set the price for an item × service (normal and express). Every change is audited. */
  const priceSchema = z.object({
    itemTypeId: z.string().min(1),
    serviceTypeId: z.string().min(1),
    price: zMoney.nullable(),
    expressPrice: zMoney.nullish(),
    isActive: z.boolean().default(true),
  });

  app.put('/prices', { preHandler: perm('catalog', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(priceSchema, req.body);
    const db = app.tdb(req);
    const [item, service] = await Promise.all([
      db.itemType.findFirst({ where: { id: body.itemTypeId } }),
      db.serviceType.findFirst({ where: { id: body.serviceTypeId } }),
    ]);
    if (!item || !service) throw notFound('Item or service');
    const existing = await db.priceListEntry.findFirst({ where: { itemTypeId: body.itemTypeId, serviceTypeId: body.serviceTypeId } });
    const old = existing ? { price: num(existing.price), expressPrice: existing.expressPrice === null ? null : num(existing.expressPrice), isActive: existing.isActive } : null;
    if (body.price === null) {
      if (existing) await db.priceListEntry.delete({ where: { id: existing.id } });
      await audit(db, req, 'price.removed', 'price', existing?.id ?? null, { item: item.name, service: service.name, ...old }, null);
      return { price: null };
    }
    const data = { price: body.price, expressPrice: body.expressPrice ?? null, isActive: body.isActive };
    const entry = existing
      ? await db.priceListEntry.update({ where: { id: existing.id }, data })
      : await db.priceListEntry.create({ data: { ...data, tenantId: a.tenant.id, itemTypeId: body.itemTypeId, serviceTypeId: body.serviceTypeId } });
    const changed = !old || old.price !== data.price || old.expressPrice !== data.expressPrice || old.isActive !== data.isActive;
    if (changed) {
      await audit(db, req, 'price.changed', 'price', entry.id, old ? { item: item.name, service: service.name, ...old } : null, {
        item: item.name,
        service: service.name,
        ...data,
      });
    }
    return { price: entry };
  });

  // ───── Packages ─────
  const packageSchema = z
    .object({
      name: z.string().trim().min(2).max(80),
      kind: z.enum(['CREDIT', 'ITEMS']),
      price: zMoney,
      creditValue: zMoney.nullish(),
      itemCount: z.number().int().min(1).max(10000).nullish(),
      itemTypeId: z.string().nullish(),
      serviceTypeId: z.string().nullish(),
      validityDays: z.number().int().min(1).max(3650).nullish(),
      description: zOptStr(300),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    })
    .superRefine((p, ctx) => {
      if (p.kind === 'CREDIT' && !(p.creditValue && p.creditValue >= p.price)) {
        ctx.addIssue({ code: 'custom', path: ['creditValue'], message: 'Credit value must be at least the price' });
      }
      if (p.kind === 'ITEMS' && !p.itemCount) ctx.addIssue({ code: 'custom', path: ['itemCount'], message: 'Number of items is required' });
    });

  app.get('/packages', { preHandler: anyPerm(['catalog', 'view'], ['wallet', 'view']) }, async (req) => {
    return { packages: await app.tdb(req).package.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] }) };
  });

  app.post('/packages', { preHandler: perm('catalog', 'create') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(packageSchema, req.body);
    const pkg = await app.tdb(req).package.create({
      data: {
        ...body,
        tenantId: a.tenant.id,
        creditValue: body.kind === 'CREDIT' ? body.creditValue : null,
        itemCount: body.kind === 'ITEMS' ? body.itemCount : null,
        itemTypeId: body.kind === 'ITEMS' ? (body.itemTypeId ?? null) : null,
        serviceTypeId: body.kind === 'ITEMS' ? (body.serviceTypeId ?? null) : null,
      },
    });
    await audit(app.tdb(req), req, 'package.created', 'package', pkg.id, null, body);
    return { package: pkg };
  });

  app.patch('/packages/:id', { preHandler: perm('catalog', 'edit') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(packageSchema, req.body);
    const db = app.tdb(req);
    const before = await db.package.findFirst({ where: { id } });
    if (!before) throw notFound('Package');
    if (before.kind !== body.kind) throw new AppError(400, 'KIND_LOCKED', 'Package type cannot be changed');
    const pkg = await db.package.update({ where: { id }, data: body });
    await audit(db, req, 'package.changed', 'package', id, before, body);
    return { package: pkg };
  });
}

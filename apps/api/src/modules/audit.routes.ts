import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { endOfDay, startOfDay } from '@laundry/shared';
import { perm } from '../lib/context';
import { parse, zDate } from '../lib/validate';

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: perm('audit', 'view') }, async (req) => {
    const q = parse(
      z.object({
        action: z.string().max(60).optional(),
        entity: z.string().max(40).optional(),
        entityId: z.string().max(64).optional(),
        userId: z.string().max(64).optional(),
        from: zDate.optional(),
        to: zDate.optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const where: Prisma.AuditLogWhereInput = {};
    if (q.action) where.action = { startsWith: q.action };
    if (q.entity) where.entity = q.entity;
    if (q.entityId) where.entityId = q.entityId;
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: startOfDay(q.from) } : {}), ...(q.to ? { lt: endOfDay(q.to) } : {}) };
    const db = app.tdb(req);
    const [logs, total, actions] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 100, take: 100 }),
      db.auditLog.count({ where }),
      db.auditLog.groupBy({ by: ['action'], _count: true, orderBy: { action: 'asc' } }),
    ]);
    return { logs, total, actions: actions.map((a) => a.action) };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseAppRef, parseScan } from '@laundry/shared';
import { anyPerm, perm, requireTenant } from '../lib/context';
import { AppError, notFound } from '../lib/errors';
import { ctxOf } from '../lib/service-context';
import { parse } from '../lib/validate';
import { ORDER_LIST_SELECT, loadOrderDetail, redactOrder } from './orders.routes';
import { advanceOrder } from './orders.service';

export async function computeAlerts(app: FastifyInstance, req: Parameters<typeof requireTenant>[0]) {
  const a = requireTenant(req);
  const db = app.tdb(req);
  const now = new Date();
  const uncollectedBefore = new Date(now.getTime() - a.settings.uncollectedDays * 86400_000);
  const [overdue, express, uncollected, onHold] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ['RECEIVED', 'IN_PROCESS', 'IRONING'] }, expectedAt: { lt: now } },
      select: ORDER_LIST_SELECT,
      orderBy: { expectedAt: 'asc' },
      take: 100,
    }),
    db.order.findMany({
      where: { status: { in: ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY'] }, express: true },
      select: ORDER_LIST_SELECT,
      orderBy: { expectedAt: 'asc' },
      take: 100,
    }),
    db.order.findMany({
      where: { status: 'READY', readyAt: { lt: uncollectedBefore } },
      select: ORDER_LIST_SELECT,
      orderBy: { readyAt: 'asc' },
      take: 100,
    }),
    db.order.findMany({ where: { onHold: true, status: { notIn: ['CANCELLED', 'DELIVERED', 'DRAFT'] } }, select: ORDER_LIST_SELECT, take: 100 }),
  ]);
  const r = (list: typeof overdue) => list.map((o) => redactOrder(req, o));
  return {
    overdue: r(overdue),
    express: r(express),
    uncollected: r(uncollected),
    onHold: r(onHold),
    uncollectedDays: a.settings.uncollectedDays,
    counts: { overdue: overdue.length, express: express.length, uncollected: uncollected.length, onHold: onHold.length },
  };
}

export default async function trackingRoutes(app: FastifyInstance) {
  /** Kanban board: active orders grouped by status. */
  app.get('/board', { preHandler: perm('tracking', 'view') }, async (req) => {
    const q = parse(z.object({ express: z.string().optional(), q: z.string().optional() }), req.query);
    const orders = await app.tdb(req).order.findMany({
      where: {
        status: { in: ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY'] },
        ...(q.express ? { express: true } : {}),
        ...(q.q
          ? { OR: [{ customer: { name: { contains: q.q, mode: 'insensitive' } } }, ...(/^\d+$/.test(q.q) ? [{ orderNo: Number(q.q) }] : [])] }
          : {}),
      },
      select: { ...ORDER_LIST_SELECT, items: { select: { itemName: true, quantity: true } } },
      orderBy: [{ express: 'desc' }, { expectedAt: 'asc' }],
      take: 500,
    });
    const columns: Record<string, unknown[]> = { RECEIVED: [], IN_PROCESS: [], IRONING: [], READY: [] };
    for (const o of orders) columns[o.status]?.push(redactOrder(req, o));
    return { columns };
  });

  app.get('/alerts', { preHandler: anyPerm(['tracking', 'view'], ['dashboard', 'view'], ['pos', 'view']) }, async (req) => {
    return computeAlerts(app, req);
  });

  /**
   * Scan a tag or receipt barcode. mode "order" moves the whole order to its
   * next status; mode "piece" moves only the scanned piece; mode "lookup" just finds it.
   */
  app.post('/scan', { preHandler: perm('tracking', 'view') }, async (req) => {
    const body = parse(z.object({ code: z.string().trim().min(1).max(100), mode: z.enum(['order', 'piece', 'lookup']).default('order') }), req.body);
    const db = app.tdb(req);
    // A customer's app pass before the order is received: open the pre-order.
    const appRef = parseAppRef(body.code);
    if (appRef) {
      const pre = await db.order.findFirst({ where: { appRef }, select: { id: true } });
      if (!pre) throw notFound(`App order ${appRef}`);
      const o = await loadOrderDetail(db, pre.id);
      return { action: 'lookup', pieceNo: null, order: redactOrder(req, o!) };
    }
    const parsed = parseScan(body.code);
    if (!parsed) throw new AppError(400, 'BAD_CODE', `Unrecognised code "${body.code}"`);
    const found = await db.order.findFirst({ where: { orderNo: parsed.orderNo }, select: { id: true } });
    if (!found) throw notFound(`Order #${parsed.orderNo}`);
    if (body.mode === 'lookup') {
      const o = await loadOrderDetail(db, found.id);
      return { action: 'lookup', pieceNo: parsed.pieceNo, order: redactOrder(req, o!) };
    }
    const a = requireTenant(req);
    if (!a.perms.modules.tracking?.includes('edit')) throw new AppError(403, 'FORBIDDEN', 'You can only look up orders');
    const ctx = ctxOf(req);
    const pieceNos = body.mode === 'piece' && parsed.pieceNo ? [parsed.pieceNo] : null;
    const r = await db.$transaction((tx) => advanceOrder(tx, ctx, found.id, pieceNos));
    const o = await loadOrderDetail(db, found.id);
    return {
      action: 'advanced',
      pieceNo: parsed.pieceNo,
      from: r.from,
      to: r.to,
      moved: r.moved,
      order: redactOrder(req, o!),
    };
  });
}

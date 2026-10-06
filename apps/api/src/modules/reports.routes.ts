import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bhDate, can, hasCap } from '@laundry/shared';
import { audit, requireTenant } from '../lib/context';
import { tablesToXlsx } from '../lib/excel';
import { forbidden, notFound } from '../lib/errors';
import { fileDataUri } from '../lib/files';
import { parse, zDate } from '../lib/validate';
import { renderPdf } from '../pdf/render';
import { reportHtml, type PdfShop } from '../pdf/templates';
import { REPORTS } from './reports.service';

export async function pdfShop(app: FastifyInstance, tenantId: string): Promise<PdfShop> {
  const t = await app.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const logo = t.logoFileId ? await app.prisma.fileObject.findFirst({ where: { id: t.logoFileId, tenantId } }) : null;
  return {
    name: t.name,
    address: t.address,
    phone: t.phone,
    email: t.email,
    vatNumber: t.vatNumber,
    crNumber: t.crNumber,
    logoDataUri: await fileDataUri(app, logo),
  };
}

export default async function reportsRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const a = requireTenant(req);
    return {
      reports: REPORTS.filter((r) => can(a.perms, r.module, 'view')).map((r) => ({
        key: r.key,
        title: r.title,
        group: r.group,
        canExport: can(a.perms, r.module, 'export'),
      })),
    };
  });

  app.get('/:key', async (req, reply) => {
    const a = requireTenant(req);
    const { key } = parse(z.object({ key: z.string() }), req.params);
    const today = bhDate();
    const q = parse(
      z.object({ from: zDate.default(`${today.slice(0, 7)}-01`), to: zDate.default(today), format: z.enum(['json', 'xlsx', 'pdf']).default('json') }),
      req.query,
    );
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw notFound('Report');
    if (!can(a.perms, def.module, 'view')) {
      await audit(app.tdb(req), req, 'report.blocked', 'report', key, null, null, 'Access to a report was blocked');
      throw forbidden('You do not have access to reports');
    }
    if (q.format !== 'json' && !can(a.perms, def.module, 'export')) throw forbidden('You are not allowed to export reports');
    const [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    const result = await def.run(app.prisma, { tenantId: a.tenant.id, from, to, showPhone: hasCap(a.perms, 'viewCustomerPhone') });
    const filename = `${key}_${from}_${to}`;
    if (q.format === 'xlsx') {
      const buf = await tablesToXlsx(result.tables.map((t, i) => ({ ...t, title: i === 0 ? `${a.tenant.name} — ${result.title}` : (t.title ?? t.name), subtitle: i === 0 ? result.subtitle : t.subtitle })));
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return buf;
    }
    if (q.format === 'pdf') {
      const html = reportHtml(await pdfShop(app, a.tenant.id), result.tables, { title: result.title, subtitle: result.subtitle });
      const pdf = await renderPdf(html);
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${filename}.pdf"`);
      return pdf;
    }
    return { ...result, from, to };
  });
}

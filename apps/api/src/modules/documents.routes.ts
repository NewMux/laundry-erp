import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  addBhd,
  addDays,
  bhDate,
  fillTemplate,
  formatBhd,
  fromFils,
  hasCap,
  parseSettings,
  renderReceiptHtml,
  startOfDay,
  endOfDay,
  toFils,
  whatsappLink,
} from '@laundry/shared';
import { anyPerm, perm, requireTenant, scopedDb } from '../lib/context';
import { signToken, verifyToken } from '../lib/crypto';
import { forbidden, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { t } from '../lib/t';
import { parse, zDate } from '../lib/validate';
import { renderPdf } from '../pdf/render';
import { payslipHtml, statementHtml, taxInvoiceHtml, type InvoiceData, type StatementRow } from '../pdf/templates';
import { buildPrintOrder, loadOrderDetail } from './orders.routes';
import { pdfShop } from './reports.routes';
import type { TenantDb } from '../lib/tenant-db';

function sendPdf(reply: FastifyReply, pdf: Buffer, filename: string, download = false) {
  reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}.pdf"`);
  return reply.send(pdf);
}

async function invoiceData(db: TenantDb, orderId: string): Promise<InvoiceData> {
  const o = await loadOrderDetail(db, orderId);
  if (!o || o.orderNo === null) throw notFound('Order');
  const tenant = await db.order.findFirstOrThrow({ where: { id: orderId }, select: { tenant: { select: { settings: true } } } });
  const settings = parseSettings(tenant.tenant.settings);
  const full = o.customerId ? await db.customer.findFirst({ where: { id: o.customerId } }) : null;
  const address = full
    ? [
        full.addrFlat && `${t('pdf.flat')} ${full.addrFlat}`,
        full.addrBuilding && `${t('pdf.bldg')} ${full.addrBuilding}`,
        full.addrHouse && `${t('pdf.house')} ${full.addrHouse}`,
        full.addrRoad && `${t('pdf.road')} ${full.addrRoad}`,
        full.addrBlock && `${t('pdf.block')} ${full.addrBlock}`,
        full.addrArea,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  return {
    orderNo: o.orderNo,
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt,
    status: o.status,
    customer: o.customer ? { name: o.customer.name, mobile: o.customer.mobile, email: full?.email, address, type: o.customer.type } : null,
    items: o.items.map((it) => ({
      lineNo: it.lineNo,
      description: `${it.itemName} — ${it.serviceName}${it.customerPackageId ? ` (${t('pdf.package')})` : ''}${it.color ? `, ${it.color}` : ''}`,
      quantity: it.quantity,
      unitLabel: it.unit === 'SQM' ? `${num(it.area)} m²` : String(it.quantity),
      unitPrice: num(it.unitPrice),
      discount: num(it.discountAmount),
      net: num(it.lineTotal),
    })),
    subtotal: num(o.subtotal),
    expressSurcharge: num(o.expressSurcharge),
    discountTotal: num(o.discountTotal),
    netAmount: num(o.netAmount),
    vatRate: num(o.vatRate),
    vatAmount: num(o.vatAmount),
    total: num(o.total),
    paidAmount: num(o.paidAmount),
    balanceDue: num(o.balanceDue),
    pricesIncludeVat: settings.pricesIncludeVat,
    payments: o.payments.filter((p) => p.kind === 'ORDER' || p.kind === 'REFUND').map((p) => ({ date: p.createdAt, method: p.method, amount: num(p.amount) })),
    footer: settings.invoice.footer,
    terms: settings.invoice.terms,
    bankDetails: settings.invoice.bankDetails,
  };
}

/** Credit-account statement: invoices charged to account (debit) and payments (credit). */
async function creditStatement(db: TenantDb, customerId: string, from: string, to: string) {
  const c = await db.customer.findFirst({ where: { id: customerId } });
  if (!c) throw notFound('Customer');
  const orders = await db.order.findMany({
    where: { customerId, onAccount: true, orderNo: { not: null }, status: { not: 'CANCELLED' }, createdAt: { lt: endOfDay(to) } },
    select: { id: true, orderNo: true, createdAt: true, total: true },
  });
  const ids = orders.map((o) => o.id);
  const payments = await db.payment.findMany({
    where: { orderId: { in: ids }, kind: { in: ['ORDER', 'REFUND'] }, createdAt: { lt: endOfDay(to) } },
    include: { order: { select: { orderNo: true } } },
  });
  const start = startOfDay(from);
  let opening = 0;
  for (const o of orders) if (o.createdAt < start) opening += toFils(num(o.total));
  for (const p of payments) if (p.createdAt < start) opening -= toFils(num(p.amount));
  const events: (StatementRow & { ts: number })[] = [];
  for (const o of orders.filter((x) => x.createdAt >= start)) {
    events.push({ ts: o.createdAt.getTime(), date: o.createdAt, ref: `INV ${o.orderNo}`, description: t('pdf.invoiceRow'), debit: num(o.total), credit: 0, balance: 0 });
  }
  const batches = new Map<string, StatementRow & { ts: number; orders: number[] }>();
  for (const p of payments.filter((x) => x.createdAt >= start)) {
    const key = p.batchId ?? p.id;
    const cur = batches.get(key) ?? {
      ts: p.createdAt.getTime(),
      date: p.createdAt,
      ref: p.receiptNo ?? 'Payment',
      description: '',
      debit: 0,
      credit: 0,
      balance: 0,
      orders: [] as number[],
    };
    cur.credit = addBhd(cur.credit, num(p.amount));
    if (p.order?.orderNo) cur.orders.push(p.order.orderNo);
    cur.description = t('pdf.paymentFor', { method: t(`paymentMethod.${p.method}`), list: cur.orders.join(', ') });
    batches.set(key, cur);
  }
  events.push(...batches.values());
  events.sort((a, b) => a.ts - b.ts);
  let bal = opening;
  const rows = events.map((e) => {
    bal += toFils(e.debit) - toFils(e.credit);
    return { date: e.date, ref: e.ref, description: e.description, debit: e.debit, credit: e.credit, balance: fromFils(bal) };
  });
  return {
    customer: { name: c.name, mobile: c.mobile, email: c.email, type: c.type, creditLimit: num(c.creditLimit) || null },
    opening: fromFils(opening),
    closing: fromFils(bal),
    rows,
    invoiced: rows.reduce((s, r) => addBhd(s, r.debit), 0),
    paid: rows.reduce((s, r) => addBhd(s, r.credit), 0),
  };
}

/** Prepaid balance statement: top-ups and packages (credit) and usage (debit). */
async function walletStatement(db: TenantDb, customerId: string, from: string, to: string) {
  const c = await db.customer.findFirst({ where: { id: customerId } });
  if (!c) throw notFound('Customer');
  const start = startOfDay(from);
  const before = await db.walletTransaction.findFirst({ where: { customerId, createdAt: { lt: start } }, orderBy: { createdAt: 'desc' } });
  const txns = await db.walletTransaction.findMany({ where: { customerId, createdAt: { gte: start, lt: endOfDay(to) } }, orderBy: { createdAt: 'asc' } });
  const orderNos = new Map(
    (await db.order.findMany({ where: { id: { in: txns.map((x) => x.orderId).filter(Boolean) as string[] } }, select: { id: true, orderNo: true } })).map((o) => [o.id, o.orderNo]),
  );
  const opening = before ? addBhd(num(before.paidAfter), num(before.bonusAfter)) : 0;
  const rows: StatementRow[] = txns.map((x) => {
    const delta = addBhd(num(x.paidDelta), num(x.bonusDelta));
    return {
      date: x.createdAt,
      ref: x.orderId ? `#${orderNos.get(x.orderId) ?? ''}` : '',
      description: `${t(`pdf.walletTypes.${x.type}`)}${x.reason && x.type !== 'ORDER_PAYMENT' ? ` — ${x.reason}` : ''}${num(x.bonusDelta) ? ` (${t('pdf.bonus', { amount: num(x.bonusDelta).toFixed(3) })})` : ''}`,
      debit: delta < 0 ? -delta : 0,
      credit: delta > 0 ? delta : 0,
      balance: addBhd(num(x.paidAfter), num(x.bonusAfter)),
    };
  });
  const closing = rows.length ? rows[rows.length - 1].balance : opening;
  return { customer: { name: c.name, mobile: c.mobile, email: c.email, type: c.type }, opening, closing, rows };
}

export default async function documentsRoutes(app: FastifyInstance) {
  const secret = app.config.appSecret;

  /** A4 tax invoice (Bahrain VAT). */
  app.get('/invoice/:orderId', { preHandler: anyPerm(['pos', 'view'], ['delivery', 'view'], ['customers', 'view']) }, async (req, reply) => {
    const a = requireTenant(req);
    if (!hasCap(a.perms, 'viewPrices')) throw forbidden();
    const { orderId } = parse(z.object({ orderId: z.string() }), req.params);
    const d = await invoiceData(app.tdb(req), orderId);
    const pdf = await renderPdf(taxInvoiceHtml(await pdfShop(app, a.tenant.id), d, t));
    return sendPdf(reply, pdf, `invoice-${d.orderNo}`);
  });

  /** 80mm receipt as PDF (same layout as the thermal print). */
  app.get('/receipt/:orderId', { preHandler: anyPerm(['pos', 'view'], ['delivery', 'view']) }, async (req, reply) => {
    const a = requireTenant(req);
    if (!hasCap(a.perms, 'viewPrices')) throw forbidden();
    const { orderId } = parse(z.object({ orderId: z.string() }), req.params);
    const order = await buildPrintOrder(app, app.tdb(req), a.tenant.id, orderId);
    const shop = await pdfShop(app, a.tenant.id);
    const html = renderReceiptHtml({ ...shop, logoUrl: shop.logoDataUri }, order, a.settings.receipt, t);
    return sendPdf(reply, await renderPdf(html, { format: '80mm' }), `receipt-${order.orderNo}`);
  });

  /** Public receipt link shared by WhatsApp / QR code (signed, no login). */
  app.get('/public/receipt/:token', async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().max(500) }), req.params);
    const clean = token.replace(/\.pdf$/, '');
    const data = verifyToken<{ t: string; o: string; k: string }>(secret, clean);
    if (!data || data.k !== 'r') throw notFound('Receipt');
    const tenant = await app.prisma.tenant.findUnique({ where: { id: data.t } });
    if (!tenant) throw notFound('Receipt');
    const db = scopedDb(app.prisma, tenant.id);
    const order = await buildPrintOrder(app, db, tenant.id, data.o);
    const settings = parseSettings(tenant.settings);
    const shop = await pdfShop(app, tenant.id);
    const html = renderReceiptHtml({ ...shop, logoUrl: shop.logoDataUri }, { ...order, qrLink: null }, { ...settings.receipt, showQr: false }, t);
    reply.header('X-Robots-Tag', 'noindex');
    if (token.endsWith('.pdf')) return sendPdf(reply, await renderPdf(html, { format: '80mm' }), `receipt-${order.orderNo}`);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    return html.replace('<body>', '<body style="background:#f3f4f6;padding:12px"><div style="background:#fff;max-width:80mm;margin:0 auto;box-shadow:0 1px 4px rgba(0,0,0,.15)">').replace('</body>', '</div></body>');
  });

  const stmtQuery = z.object({
    from: zDate.optional(),
    to: zDate.optional(),
    type: z.enum(['credit', 'wallet']).default('credit'),
  });

  function stmtRange(q: z.infer<typeof stmtQuery>) {
    const today = bhDate();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    return { from, to };
  }

  async function statementPdf(db: TenantDb, tenantId: string, customerId: string, q: z.infer<typeof stmtQuery>) {
    const { from, to } = stmtRange(q);
    const shop = await pdfShop(app, tenantId);
    if (q.type === 'wallet') {
      const s = await walletStatement(db, customerId, from, to);
      return {
        name: s.customer.name,
        pdf: await renderPdf(
          statementHtml(shop, { title: t('pdf.walletStatementTitle'), customer: s.customer, from, to, opening: s.opening, closing: s.closing, rows: s.rows, debitLabel: t('pdf.used'), creditLabel: t('pdf.added'), balanceLabel: t('pdf.balance') }),
        ),
      };
    }
    const s = await creditStatement(db, customerId, from, to);
    return {
      name: s.customer.name,
      pdf: await renderPdf(
        statementHtml(shop, {
          title: t('pdf.statementTitle'),
          customer: s.customer,
          from,
          to,
          opening: s.opening,
          closing: s.closing,
          rows: s.rows,
          debitLabel: t('pdf.invoiced'),
          creditLabel: t('pdf.paidCol'),
          balanceLabel: t('pdf.balance'),
          summary: [
            { label: t('pdf.invoicedInPeriod'), value: `BHD ${formatBhd(s.invoiced, false)}` },
            { label: t('pdf.paidInPeriod'), value: `BHD ${formatBhd(s.paid, false)}` },
          ],
          note: t('pdf.settleNote'),
        }),
      ),
    };
  }

  /** Customer statement PDF (credit account or prepaid balance). */
  app.get('/statement/:customerId', { preHandler: anyPerm(['customers', 'view'], ['wallet', 'view']) }, async (req, reply) => {
    const a = requireTenant(req);
    const { customerId } = parse(z.object({ customerId: z.string() }), req.params);
    const q = parse(stmtQuery, req.query);
    const { pdf, name } = await statementPdf(app.tdb(req), a.tenant.id, customerId, q);
    return sendPdf(reply, pdf, `statement-${name.replace(/[^\w-]+/g, '_')}`);
  });

  /** WhatsApp link for sharing a statement. */
  app.get('/statement/:customerId/share', { preHandler: perm('customers', 'view') }, async (req) => {
    const a = requireTenant(req);
    if (!hasCap(a.perms, 'viewCustomerPhone')) throw forbidden();
    const { customerId } = parse(z.object({ customerId: z.string() }), req.params);
    const q = parse(stmtQuery, req.query);
    const { from, to } = stmtRange(q);
    const c = await app.tdb(req).customer.findFirst({ where: { id: customerId } });
    if (!c) throw notFound('Customer');
    const token = signToken(secret, { t: a.tenant.id, c: customerId, k: 's', y: q.type, f: from, u: to, e: addDays(bhDate(), 30) });
    const link = `${app.config.publicUrl}/api/documents/public/statement/${token}.pdf`;
    const text = fillTemplate(a.settings.whatsapp.statementShare, { customer: c.name, shop: a.tenant.name, link });
    return { url: whatsappLink(c.mobile, text), link };
  });

  app.get('/public/statement/:token', async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().max(800) }), req.params);
    const data = verifyToken<{ t: string; c: string; k: string; y: 'credit' | 'wallet'; f: string; u: string; e: string }>(secret, token.replace(/\.pdf$/, ''));
    if (!data || data.k !== 's' || data.e < bhDate()) throw notFound('Statement');
    const db = scopedDb(app.prisma, data.t);
    const { pdf } = await statementPdf(db, data.t, data.c, { type: data.y, from: data.f, to: data.u });
    reply.header('X-Robots-Tag', 'noindex');
    return sendPdf(reply, pdf, 'statement');
  });

  /** Payslip PDF per employee. */
  app.get('/payslip/:itemId', { preHandler: perm('payroll', 'view') }, async (req, reply) => {
    const a = requireTenant(req);
    const { itemId } = parse(z.object({ itemId: z.string() }), req.params);
    const db = app.tdb(req);
    const item = await db.payrollItem.findFirst({ where: { id: itemId }, include: { payrollRun: true, employee: true } });
    if (!item) throw notFound('Payslip');
    const adjustments = await db.employeeAdjustment.findMany({
      where: item.payrollRun.status === 'PAID' ? { payrollItemId: item.id } : { employeeId: item.employeeId, payrollItemId: null, date: { lte: `${item.payrollRun.month}-31` } },
      orderBy: { date: 'asc' },
    });
    const ded = adjustments.filter((x) => x.type === 'DEDUCTION').map((x) => ({ name: x.note || t('pdf.deductionOn', { date: x.date }), amount: num(x.amount) }));
    const leaveDed = fromFils(toFils(num(item.deductions)) - ded.reduce((s, x) => s + toFils(x.amount), 0));
    if (leaveDed > 0) ded.push({ name: t('pdf.unpaidLeave', { days: num(item.unpaidLeaveDays) }), amount: leaveDed });
    const html = payslipHtml(
      await pdfShop(app, a.tenant.id),
      {
        month: item.payrollRun.month,
        employee: { name: item.employeeName, position: item.position, cpr: item.employee.cpr, nationality: item.employee.nationality, joinDate: item.employee.joinDate },
        basic: num(item.basic),
        allowances: (item.allowanceDetails as unknown as { name: string; amount: number }[]) ?? [],
        deductions: ded,
        advances: adjustments.filter((x) => x.type === 'ADVANCE').map((x) => ({ name: x.date, amount: num(x.amount) })),
        net: num(item.net),
        daysWorked: item.daysWorked,
        unpaidLeaveDays: num(item.unpaidLeaveDays),
        status: item.payrollRun.status,
        paidDate: item.payrollRun.paidDate,
        paymentMethod: item.payrollRun.paymentMethod,
      },
      t,
    );
    return sendPdf(reply, await renderPdf(html), `payslip-${item.employeeName.replace(/[^\w-]+/g, '_')}-${item.payrollRun.month}`);
  });

}

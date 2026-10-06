import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addBhd, subBhd, type PrintTopup } from '@laundry/shared';
import { audit, perm, requireTenant } from '../lib/context';
import { currentBusinessDate } from '../lib/business-date';
import { AppError, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import { ctxOf, nextReceiptNo } from '../lib/service-context';
import { parse, zMoney, zOptStr } from '../lib/validate';
import { applyWalletDelta, lockCustomer } from './wallet.service';

const methodSchema = z.enum(['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER']);

export default async function walletRoutes(app: FastifyInstance) {
  /**
   * Top up a customer's prepaid balance, optionally by buying a package.
   * Money received is a customer liability, not revenue, until used on orders.
   */
  const topupSchema = z
    .object({
      customerId: z.string().min(1),
      method: methodSchema,
      amount: zMoney.optional(),
      packageId: z.string().optional(),
      reference: zOptStr(100),
    })
    .refine((v) => v.packageId || (v.amount && v.amount > 0), 'Enter an amount or choose a package');

  app.post('/topup', { preHandler: perm('wallet', 'create') }, async (req) => {
    const body = parse(topupSchema, req.body);
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const r = await db.$transaction(async (tx) => {
      const customer = await lockCustomer(tx, ctx, body.customerId);
      const businessDate = await currentBusinessDate(tx);
      const receiptNo = await nextReceiptNo(tx, ctx.tenantId);
      if (!body.packageId) {
        const payment = await tx.payment.create({
          data: {
            tenantId: ctx.tenantId,
            kind: 'TOPUP',
            method: body.method,
            amount: body.amount!,
            customerId: customer.id,
            businessDate,
            receiptNo,
            reference: body.reference ?? null,
            note: 'Balance top-up',
            createdById: ctx.userId,
            createdByName: ctx.userName,
          },
        });
        const w = await applyWalletDelta(tx, ctx, customer.id, { paidDelta: body.amount!, bonusDelta: 0, type: 'TOPUP', paymentId: payment.id, reason: 'Top-up' });
        return { payment, wallet: w, description: 'Balance top-up', credit: body.amount!, bonus: 0, itemsLine: null as string | null, customer };
      }
      const pkg = await tx.package.findFirst({ where: { id: body.packageId, isActive: true } });
      if (!pkg) throw notFound('Package');
      const price = num(pkg.price);
      const expiresAt = pkg.validityDays ? new Date(Date.now() + pkg.validityDays * 86400_000) : null;
      const payment = await tx.payment.create({
        data: {
          tenantId: ctx.tenantId,
          kind: 'PACKAGE_SALE',
          method: body.method,
          amount: price,
          customerId: customer.id,
          businessDate,
          receiptNo,
          reference: body.reference ?? null,
          note: pkg.name,
          createdById: ctx.userId,
          createdByName: ctx.userName,
        },
      });
      if (pkg.kind === 'CREDIT') {
        const bonus = subBhd(num(pkg.creditValue), price);
        const cp = await tx.customerPackage.create({
          data: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            packageId: pkg.id,
            name: pkg.name,
            kind: 'CREDIT',
            pricePaid: price,
            bonusGranted: bonus,
            bonusRemaining: bonus,
            expiresAt,
            paymentId: payment.id,
            createdById: ctx.userId,
          },
        });
        const w = await applyWalletDelta(tx, ctx, customer.id, {
          paidDelta: price,
          bonusDelta: bonus,
          type: 'PACKAGE',
          paymentId: payment.id,
          customerPackageId: cp.id,
          reason: pkg.name,
        });
        return { payment, wallet: w, description: pkg.name, credit: price, bonus, itemsLine: null, customer };
      }
      await tx.customerPackage.create({
        data: {
          tenantId: ctx.tenantId,
          customerId: customer.id,
          packageId: pkg.id,
          name: pkg.name,
          kind: 'ITEMS',
          itemTypeId: pkg.itemTypeId,
          serviceTypeId: pkg.serviceTypeId,
          totalItems: pkg.itemCount ?? 0,
          remainingItems: pkg.itemCount ?? 0,
          pricePaid: price,
          expiresAt,
          paymentId: payment.id,
          createdById: ctx.userId,
        },
      });
      const c = await tx.customer.findFirstOrThrow({ where: { id: customer.id } });
      return {
        payment,
        wallet: { balanceAfter: addBhd(num(c.walletPaid), num(c.walletBonus)) },
        description: pkg.name,
        credit: 0,
        bonus: 0,
        itemsLine: `${pkg.itemCount} items${expiresAt ? `, valid until ${expiresAt.toISOString().slice(0, 10)}` : ''}`,
        customer,
      };
    });
    const receipt: PrintTopup = {
      receiptNo: r.payment.receiptNo!,
      createdAt: r.payment.createdAt.toISOString(),
      cashierName: ctx.userName,
      customer: { name: r.customer.name, mobile: r.customer.mobile },
      description: r.description,
      method: body.method,
      amountPaid: num(r.payment.amount),
      creditAdded: r.credit,
      bonusAdded: r.bonus,
      balanceAfter: r.wallet.balanceAfter,
      itemsLine: r.itemsLine,
    };
    return { receipt, paymentId: r.payment.id };
  });

  /** Reprint data for a top-up / package receipt. */
  app.get('/receipt/:paymentId', { preHandler: perm('wallet', 'view') }, async (req) => {
    const a = requireTenant(req);
    const { paymentId } = parse(z.object({ paymentId: z.string() }), req.params);
    const db = app.tdb(req);
    const p = await db.payment.findFirst({ where: { id: paymentId, kind: { in: ['TOPUP', 'PACKAGE_SALE'] } }, include: { customer: true } });
    if (!p || !p.customer) throw notFound('Receipt');
    const txn = await db.walletTransaction.findFirst({ where: { paymentId: p.id } });
    const cp = await db.customerPackage.findFirst({ where: { paymentId: p.id } });
    const receipt: PrintTopup = {
      receiptNo: p.receiptNo ?? p.id.slice(0, 8),
      createdAt: p.createdAt.toISOString(),
      cashierName: p.createdByName,
      customer: { name: p.customer.name, mobile: p.customer.mobile },
      description: p.note ?? 'Balance top-up',
      method: p.method,
      amountPaid: num(p.amount),
      creditAdded: txn ? num(txn.paidDelta) : 0,
      bonusAdded: txn ? num(txn.bonusDelta) : 0,
      balanceAfter: txn ? addBhd(num(txn.paidAfter), num(txn.bonusAfter)) : addBhd(num(p.customer.walletPaid), num(p.customer.walletBonus)),
      itemsLine: cp && cp.kind === 'ITEMS' ? `${cp.totalItems} items` : null,
    };
    return {
      receipt,
      shop: {
        name: a.tenant.name,
        address: a.tenant.address,
        phone: a.tenant.phone,
        vatNumber: a.tenant.vatNumber,
        crNumber: a.tenant.crNumber,
        logoUrl: a.tenant.logoFileId ? `/api/files/${a.tenant.logoFileId}` : null,
      },
      settings: a.settings.receipt,
    };
  });

  /** Manual balance adjustment with a reason (audited). */
  app.post('/adjust', { preHandler: perm('wallet', 'edit') }, async (req) => {
    const body = parse(
      z.object({
        customerId: z.string().min(1),
        paidDelta: z.number().min(-100000).max(100000).default(0),
        bonusDelta: z.number().min(-100000).max(100000).default(0),
        reason: z.string().trim().min(3).max(300),
      }),
      req.body,
    );
    if (!body.paidDelta && !body.bonusDelta) throw new AppError(400, 'NO_CHANGE', 'Enter an amount to adjust');
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const r = await db.$transaction(async (tx) => {
      const before = await lockCustomer(tx, ctx, body.customerId);
      const w = await applyWalletDelta(tx, ctx, body.customerId, {
        paidDelta: Math.round(body.paidDelta * 1000) / 1000,
        bonusDelta: Math.round(body.bonusDelta * 1000) / 1000,
        type: 'ADJUSTMENT',
        reason: body.reason,
      });
      return { before, w };
    });
    await audit(
      db,
      req,
      'wallet.adjustment',
      'customer',
      body.customerId,
      { paid: num(r.before.walletPaid), bonus: num(r.before.walletBonus) },
      { paid: r.w.paidAfter, bonus: r.w.bonusAfter },
      body.reason,
    );
    return { paid: r.w.paidAfter, bonus: r.w.bonusAfter, balance: r.w.balanceAfter };
  });

  /** Pay back unused paid credit to the customer. Bonus credit is never refundable. */
  app.post('/refund', { preHandler: perm('wallet', 'delete') }, async (req) => {
    const body = parse(
      z.object({ customerId: z.string().min(1), amount: zMoney.refine((v) => v > 0), method: methodSchema, reason: z.string().trim().min(3).max(300) }),
      req.body,
    );
    const ctx = ctxOf(req);
    const db = app.tdb(req);
    const r = await db.$transaction(async (tx) => {
      const c = await lockCustomer(tx, ctx, body.customerId);
      if (body.amount > num(c.walletPaid)) throw new AppError(400, 'INSUFFICIENT_BALANCE', `Only ${num(c.walletPaid).toFixed(3)} of paid credit can be refunded`);
      const businessDate = await currentBusinessDate(tx);
      const receiptNo = await nextReceiptNo(tx, ctx.tenantId);
      const payment = await tx.payment.create({
        data: {
          tenantId: ctx.tenantId,
          kind: 'WALLET_REFUND',
          method: body.method,
          amount: -body.amount,
          customerId: c.id,
          businessDate,
          receiptNo,
          note: body.reason,
          createdById: ctx.userId,
          createdByName: ctx.userName,
        },
      });
      const w = await applyWalletDelta(tx, ctx, c.id, { paidDelta: -body.amount, bonusDelta: 0, type: 'REFUND', paymentId: payment.id, reason: body.reason });
      return { c, w, receiptNo };
    });
    await audit(db, req, 'wallet.refund', 'customer', body.customerId, { paid: num(r.c.walletPaid) }, { paid: r.w.paidAfter, refunded: body.amount, method: body.method }, body.reason);
    return { receiptNo: r.receiptNo, balance: r.w.balanceAfter };
  });

  app.get('/packages/:customerId', { preHandler: perm('wallet', 'view') }, async (req) => {
    const { customerId } = parse(z.object({ customerId: z.string() }), req.params);
    const packages = await app.tdb(req).customerPackage.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return { packages };
  });
}

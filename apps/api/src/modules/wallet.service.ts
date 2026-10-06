import { addBhd, fromFils, toFils, type WalletTxnType } from '@laundry/shared';
import { AppError, notFound } from '../lib/errors';
import { num } from '../lib/prisma';
import type { Ctx } from '../lib/service-context';
import type { TenantTx } from '../lib/tenant-db';

export interface WalletDelta {
  paidDelta: number;
  bonusDelta: number;
  type: WalletTxnType;
  paymentId?: string | null;
  orderId?: string | null;
  customerPackageId?: string | null;
  reason?: string | null;
}

/** Lock a customer row for the rest of the transaction (wallet consistency). */
export async function lockCustomer(tx: TenantTx, ctx: Ctx, customerId: string) {
  await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customerId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
  const c = await tx.customer.findFirst({ where: { id: customerId } });
  if (!c) throw notFound('Customer');
  return c;
}

/**
 * Apply a movement to a customer's prepaid wallet and log it.
 * Paid credit and bonus credit are tracked separately; neither may go negative.
 */
export async function applyWalletDelta(tx: TenantTx, ctx: Ctx, customerId: string, d: WalletDelta) {
  const c = await lockCustomer(tx, ctx, customerId);
  const paidAfter = fromFils(toFils(num(c.walletPaid)) + toFils(d.paidDelta));
  const bonusAfter = fromFils(toFils(num(c.walletBonus)) + toFils(d.bonusDelta));
  if (paidAfter < 0 || bonusAfter < 0) {
    throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Not enough prepaid balance');
  }
  await tx.customer.update({ where: { id: customerId }, data: { walletPaid: paidAfter, walletBonus: bonusAfter } });

  // Bonus credit from packages with an expiry is consumed soonest-expiring first.
  if (d.bonusDelta < 0 && d.type !== 'EXPIRY') {
    let remaining = toFils(-d.bonusDelta);
    const pkgs = await tx.customerPackage.findMany({
      where: { customerId, kind: 'CREDIT', status: 'ACTIVE', bonusRemaining: { gt: 0 } },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    for (const p of pkgs) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, toFils(num(p.bonusRemaining)));
      await tx.customerPackage.update({ where: { id: p.id }, data: { bonusRemaining: fromFils(toFils(num(p.bonusRemaining)) - take) } });
      remaining -= take;
    }
  }

  const txn = await tx.walletTransaction.create({
    data: {
      tenantId: ctx.tenantId,
      customerId,
      type: d.type,
      paidDelta: d.paidDelta,
      bonusDelta: d.bonusDelta,
      paidAfter,
      bonusAfter,
      paymentId: d.paymentId ?? null,
      orderId: d.orderId ?? null,
      customerPackageId: d.customerPackageId ?? null,
      reason: d.reason ?? null,
      createdById: ctx.userId,
    },
  });
  return { txn, paidAfter, bonusAfter, balanceAfter: addBhd(paidAfter, bonusAfter) };
}

/** Expire packages past their expiry date: unused bonus credit is removed, item packages close. */
export async function expirePackages(tx: TenantTx, ctx: Ctx, now = new Date()): Promise<number> {
  const due = await tx.customerPackage.findMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } } });
  for (const p of due) {
    if (p.kind === 'CREDIT' && num(p.bonusRemaining) > 0) {
      const c = await lockCustomer(tx, ctx, p.customerId);
      const remove = Math.min(num(p.bonusRemaining), num(c.walletBonus));
      if (remove > 0) {
        await applyWalletDelta(tx, ctx, p.customerId, {
          paidDelta: 0,
          bonusDelta: -remove,
          type: 'EXPIRY',
          customerPackageId: p.id,
          reason: `Bonus credit expired (${p.name})`,
        });
      }
    }
    await tx.customerPackage.update({ where: { id: p.id }, data: { status: 'EXPIRED', bonusRemaining: 0 } });
  }
  return due.length;
}

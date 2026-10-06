import type { FastifyRequest } from 'fastify';
import type { Permissions, TenantSettings, WorkingHours } from '@laundry/shared';
import { DEFAULT_WORKING_HOURS } from '@laundry/shared';
import { requireTenant } from './context';
import type { TenantTx } from './tenant-db';

/** Who is acting, in which shop, with which settings — passed to services. */
export interface Ctx {
  tenantId: string;
  userId: string;
  userName: string;
  settings: TenantSettings;
  perms: Permissions;
  workingHours: WorkingHours;
  roleKey: string | null;
}

export function ctxOf(req: FastifyRequest): Ctx {
  const a = requireTenant(req);
  const wh = a.tenant.workingHours as unknown as WorkingHours;
  return {
    tenantId: a.tenant.id,
    userId: a.user.id,
    userName: a.user.name,
    settings: a.settings,
    perms: a.perms,
    workingHours: wh && typeof wh === 'object' && 'sun' in wh ? wh : DEFAULT_WORKING_HOURS,
    roleKey: a.roleKey,
  };
}

/** Allocate the next receipt number (top-ups, settlements, refunds). */
export async function nextReceiptNo(tx: TenantTx, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ receiptSeq: number }[]>`
    UPDATE "Tenant" SET "receiptSeq" = "receiptSeq" + 1 WHERE id = ${tenantId} RETURNING "receiptSeq"`;
  return `R-${String(rows[0].receiptSeq).padStart(6, '0')}`;
}

/** Allocate the next order / tax invoice number. */
export async function nextOrderNo(tx: TenantTx, tenantId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ orderSeq: number }[]>`
    UPDATE "Tenant" SET "orderSeq" = "orderSeq" + 1 WHERE id = ${tenantId} RETURNING "orderSeq"`;
  return rows[0].orderSeq;
}

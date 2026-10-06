import type { Plan, Tenant } from '@prisma/client';

export interface PlanFeatures {
  customPermissions: boolean;
  dataExport: boolean;
}

export function planFeatures(plan: Pick<Plan, 'features'> | null | undefined): PlanFeatures {
  const f = (plan?.features ?? {}) as Partial<PlanFeatures>;
  return { customPermissions: f.customPermissions === true, dataExport: f.dataExport !== false };
}

export type SubscriptionState = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export interface SubscriptionInfo {
  state: SubscriptionState;
  readOnly: boolean;
  endsAt: Date | null;
  daysLeft: number | null;
  showBanner: boolean;
}

/**
 * Subscription state. An expired trial or subscription puts the tenant in
 * read-only mode (data is never deleted); a suspended tenant cannot log in.
 */
export function subscriptionInfo(t: Pick<Tenant, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>, now = new Date()): SubscriptionInfo {
  if (t.status === 'SUSPENDED') return { state: 'SUSPENDED', readOnly: true, endsAt: null, daysLeft: null, showBanner: true };
  const endsAt = t.status === 'TRIAL' ? t.trialEndsAt : t.currentPeriodEnd;
  if (!endsAt) return { state: t.status, readOnly: false, endsAt: null, daysLeft: null, showBanner: false };
  const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / 86400000);
  if (endsAt.getTime() < now.getTime()) {
    return { state: 'EXPIRED', readOnly: true, endsAt, daysLeft, showBanner: true };
  }
  return { state: t.status, readOnly: false, endsAt, daysLeft, showBanner: daysLeft <= 7 };
}

export function maxUsersFor(t: Pick<Tenant, 'maxUsersOverride'>, plan: Pick<Plan, 'maxUsers'> | null | undefined): number {
  return t.maxUsersOverride ?? plan?.maxUsers ?? 3;
}

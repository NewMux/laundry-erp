import type { RoleKey } from './enums';

/**
 * Permission model: a matrix of modules × actions, plus a few capability
 * flags and a maximum discount percentage. Stored as JSON on each Role.
 */
export const MODULES = [
  'dashboard',
  'pos',
  'tracking',
  'delivery',
  'customers',
  'wallet',
  'catalog',
  'expenses',
  'cash_closing',
  'reports',
  'finance_reports',
  'staff',
  'attendance',
  'payroll',
  'users',
  'settings',
  'audit',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Capability flags that don't fit the module matrix.
 * - viewPrices: see prices/amounts on orders (workers don't)
 * - viewCustomerPhone: see customer phone numbers
 * - cancelPaidOrders: cancel/void an order that has payments ("delete a paid invoice")
 * - overridePrice: change a line's unit price at the counter
 * - editSalary: change salary fields of employees
 */
export const CAPS = ['viewPrices', 'viewCustomerPhone', 'cancelPaidOrders', 'overridePrice', 'editSalary'] as const;
export type Cap = (typeof CAPS)[number];

export interface Permissions {
  modules: Partial<Record<Module, Action[]>>;
  caps: Partial<Record<Cap, boolean>>;
  /** Max total discount as % of the order value. 100 = unlimited. */
  maxDiscountPercent: number;
}

const ALL: Action[] = [...ACTIONS];

function full(): Permissions['modules'] {
  const m: Permissions['modules'] = {};
  for (const mod of MODULES) m[mod] = [...ALL];
  return m;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permissions> = {
  OWNER: {
    modules: full(),
    caps: { viewPrices: true, viewCustomerPhone: true, cancelPaidOrders: true, overridePrice: true, editSalary: true },
    maxDiscountPercent: 100,
  },
  MANAGER: {
    modules: {
      dashboard: ['view'],
      pos: ['view', 'create', 'edit', 'delete', 'export'],
      tracking: ['view', 'edit'],
      delivery: ['view', 'create'],
      customers: ['view', 'create', 'edit', 'export'],
      wallet: ['view', 'create', 'edit'],
      catalog: ['view'],
      expenses: ['view', 'create', 'edit', 'export'],
      cash_closing: ['view', 'create'],
      reports: ['view', 'export'],
      staff: ['view', 'create', 'edit'],
      attendance: ['view', 'create', 'edit', 'export'],
    },
    caps: { viewPrices: true, viewCustomerPhone: true, cancelPaidOrders: true, overridePrice: true, editSalary: false },
    maxDiscountPercent: 20,
  },
  CASHIER: {
    modules: {
      pos: ['view', 'create', 'edit'],
      tracking: ['view', 'edit'],
      delivery: ['view', 'create'],
      customers: ['view', 'create', 'edit'],
      wallet: ['view', 'create'],
      cash_closing: ['view', 'create'],
    },
    caps: { viewPrices: true, viewCustomerPhone: true, cancelPaidOrders: false, overridePrice: false, editSalary: false },
    maxDiscountPercent: 5,
  },
  WORKER: {
    modules: {
      tracking: ['view', 'edit'],
    },
    caps: { viewPrices: false, viewCustomerPhone: false, cancelPaidOrders: false, overridePrice: false, editSalary: false },
    maxDiscountPercent: 0,
  },
};

export function can(perms: Permissions | null | undefined, module: Module, action: Action = 'view'): boolean {
  if (!perms) return false;
  return perms.modules[module]?.includes(action) ?? false;
}

export function hasCap(perms: Permissions | null | undefined, cap: Cap): boolean {
  if (!perms) return false;
  return perms.caps[cap] === true;
}

/** Normalise untrusted JSON into a valid Permissions object. */
export function sanitizePermissions(input: unknown): Permissions {
  const src = (input ?? {}) as Partial<Permissions>;
  const modules: Permissions['modules'] = {};
  for (const mod of MODULES) {
    const acts = (src.modules as Record<string, unknown> | undefined)?.[mod];
    if (Array.isArray(acts)) {
      const valid = ACTIONS.filter((a) => acts.includes(a));
      if (valid.length) modules[mod] = valid;
    }
  }
  const caps: Permissions['caps'] = {};
  for (const c of CAPS) caps[c] = (src.caps as Record<string, unknown> | undefined)?.[c] === true;
  let max = Number(src.maxDiscountPercent);
  if (!Number.isFinite(max) || max < 0) max = 0;
  if (max > 100) max = 100;
  return { modules, caps, maxDiscountPercent: max };
}

/** Owners always have everything regardless of stored JSON. */
export function effectivePermissions(roleKey: string, stored: unknown): Permissions {
  if (roleKey === 'OWNER') return DEFAULT_ROLE_PERMISSIONS.OWNER;
  return sanitizePermissions(stored);
}

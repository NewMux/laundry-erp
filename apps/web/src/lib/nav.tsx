import type { ReactNode } from 'react';
import {
  BarChart3,
  Banknote,
  CalendarCheck,
  ClipboardList,
  Columns3,
  LayoutDashboard,
  PackageCheck,
  Receipt,
  ScanLine,
  Settings,
  ShoppingBasket,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { Action, Module } from '@laundry/shared';

export interface NavItem {
  to: string;
  label: string; // i18n key
  icon: ReactNode;
  perm?: [Module, Action];
  anyPerm?: [Module, Action][];
  group: 'main' | 'finance' | 'staff' | 'admin';
  mobile?: number; // position in the mobile bottom bar
}

const ic = 'size-5';

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'nav.dashboard', icon: <LayoutDashboard className={ic} />, perm: ['dashboard', 'view'], group: 'main', mobile: 1 },
  { to: '/pos', label: 'nav.pos', icon: <ShoppingBasket className={ic} />, perm: ['pos', 'create'], group: 'main', mobile: 2 },
  { to: '/orders', label: 'nav.orders', icon: <ClipboardList className={ic} />, anyPerm: [['pos', 'view'], ['tracking', 'view'], ['delivery', 'view']], group: 'main', mobile: 3 },
  { to: '/orders/board', label: 'nav.board', icon: <Columns3 className={ic} />, perm: ['tracking', 'view'], group: 'main' },
  { to: '/scan', label: 'nav.scan', icon: <ScanLine className={ic} />, perm: ['tracking', 'view'], group: 'main', mobile: 4 },
  { to: '/delivery', label: 'nav.delivery', icon: <PackageCheck className={ic} />, perm: ['delivery', 'view'], group: 'main' },
  { to: '/customers', label: 'nav.customers', icon: <Users className={ic} />, perm: ['customers', 'view'], group: 'main' },
  { to: '/finance/expenses', label: 'nav.expenses', icon: <Receipt className={ic} />, perm: ['expenses', 'view'], group: 'finance' },
  { to: '/finance/cash', label: 'nav.cash', icon: <Banknote className={ic} />, perm: ['cash_closing', 'view'], group: 'finance' },
  { to: '/reports', label: 'nav.reports', icon: <BarChart3 className={ic} />, anyPerm: [['reports', 'view'], ['finance_reports', 'view']], group: 'finance' },
  { to: '/staff/employees', label: 'nav.employees', icon: <UserCog className={ic} />, perm: ['staff', 'view'], group: 'staff' },
  { to: '/staff/attendance', label: 'nav.attendance', icon: <CalendarCheck className={ic} />, perm: ['attendance', 'view'], group: 'staff' },
  { to: '/staff/payroll', label: 'nav.payroll', icon: <Wallet className={ic} />, perm: ['payroll', 'view'], group: 'staff' },
  { to: '/settings', label: 'nav.settings', icon: <Settings className={ic} />, anyPerm: [['settings', 'view'], ['catalog', 'view'], ['users', 'view'], ['audit', 'view']], group: 'admin' },
];

export function allowed(item: Pick<NavItem, 'perm' | 'anyPerm'>, can: (m: Module, a?: Action) => boolean): boolean {
  if (item.perm) return can(item.perm[0], item.perm[1]);
  if (item.anyPerm) return item.anyPerm.some(([m, a]) => can(m, a));
  return true;
}

/** Where a user lands after signing in, based on what they can do. */
export function homePath(can: (m: Module, a?: Action) => boolean): string {
  if (can('dashboard')) return '/dashboard';
  if (can('pos', 'create')) return '/pos';
  if (can('tracking', 'edit')) return '/scan';
  const first = NAV.find((n) => allowed(n, can));
  return first?.to ?? '/account';
}

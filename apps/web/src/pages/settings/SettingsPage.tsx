import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { Action, Module } from '@laundry/shared';
import { useAuth } from '../../lib/auth';
import { PageHeader } from '../../components/ui';
import ShopSettings from './ShopSettings';
import PreferencesSettings from './PreferencesSettings';
import PriceListSettings from './PriceListSettings';
import PackagesSettings from './PackagesSettings';
import PrintingSettings from './PrintingSettings';
import UsersSettings from './UsersSettings';
import RolesSettings from './RolesSettings';
import SubscriptionSettings from './SubscriptionSettings';
import AuditLogPage from './AuditLogPage';

const SECTIONS: { path: string; label: string; perm: [Module, Action]; el: React.ReactNode }[] = [
  { path: 'shop', label: 'settings.shop', perm: ['settings', 'view'], el: <ShopSettings /> },
  { path: 'pricing', label: 'settings.pricing', perm: ['settings', 'view'], el: <PreferencesSettings section="pricing" /> },
  { path: 'price-list', label: 'settings.priceList', perm: ['catalog', 'view'], el: <PriceListSettings /> },
  { path: 'packages', label: 'settings.packages', perm: ['catalog', 'view'], el: <PackagesSettings /> },
  { path: 'printing', label: 'settings.printing', perm: ['settings', 'view'], el: <PrintingSettings /> },
  { path: 'messages', label: 'settings.messages', perm: ['settings', 'view'], el: <PreferencesSettings section="messages" /> },
  { path: 'users', label: 'settings.users', perm: ['users', 'view'], el: <UsersSettings /> },
  { path: 'roles', label: 'settings.roles', perm: ['users', 'view'], el: <RolesSettings /> },
  { path: 'subscription', label: 'settings.subscription', perm: ['settings', 'view'], el: <SubscriptionSettings /> },
  { path: 'audit', label: 'settings.audit', perm: ['audit', 'view'], el: <AuditLogPage /> },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const sections = SECTIONS.filter((s) => can(s.perm[0], s.perm[1]));
  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6">
      <PageHeader title={t('settings.title')} />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto lg:flex-col">
          {sections.map((s) => (
            <NavLink
              key={s.path}
              to={`/settings/${s.path}`}
              className={({ isActive }) =>
                clsx('shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/60')
              }
            >
              {t(s.label)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Routes>
            {sections.map((s) => (
              <Route key={s.path} path={s.path} element={s.el} />
            ))}
            <Route path="*" element={<Navigate to={sections[0] ? `/settings/${sections[0].path}` : '/'} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

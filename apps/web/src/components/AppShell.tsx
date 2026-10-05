import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Bell, Clock, KeyRound, LogOut, Menu, ShieldAlert, UserRound, Users, WifiOff, X, Lock } from 'lucide-react';
import { parseScan } from '@laundry/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { feedback, useBarcodeScanner, useOnline } from '../lib/hooks';
import { NAV, allowed } from '../lib/nav';
import { Badge, Button, Field, Input, Modal } from './ui';
import { useToast } from './toast';

function Logo({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="2" width="16" height="20" rx="3" />
          <circle cx="12" cy="13" r="5" />
          <path d="M9 13.5c1-1 2-1 3 0s2 1 3 0" />
          <circle cx="8" cy="5.5" r=".8" fill="currentColor" />
        </svg>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold leading-tight text-slate-900 bidi">{name}</div>
        <div className="text-[11px] leading-tight text-slate-500">NewMux Laundry</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { me, can, readOnly } = useAuth();
  const nav = NAV.filter((n) => allowed(n, can));
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const online = useOnline();

  useEffect(() => setDrawer(false), [loc.pathname]);

  // Scan a receipt/tag anywhere (USB scanner) to open the order. Pages with their own scanner handle it themselves.
  const ownScanner = loc.pathname.startsWith('/scan') || loc.pathname.startsWith('/delivery') || loc.pathname.startsWith('/pos');
  useBarcodeScanner(async (code) => {
    const p = parseScan(code);
    if (!p) return;
    try {
      const r = await api.get(`/api/orders/no/${p.orderNo}`);
      feedback(true);
      navigate(`/orders/${r.order.id}`);
    } catch (e) {
      feedback(false);
      toast.error(e);
    }
  }, !ownScanner && (can('pos', 'view') || can('tracking', 'view') || can('delivery', 'view')));

  const groups: { key: string; label?: string }[] = [
    { key: 'main' },
    { key: 'finance', label: t('nav.finance') },
    { key: 'staff', label: t('nav.staff') },
    { key: 'admin' },
  ];
  const mobileItems = nav.filter((n) => n.mobile).sort((a, b) => a.mobile! - b.mobile!).slice(0, 4);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {groups.map((g) => {
        const items = nav.filter((n) => n.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className="mb-2">
            {g.label && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>}
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/orders'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100',
                  )
                }
              >
                {n.icon}
                {t(n.label)}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-100 p-3">
          <Logo name={me?.tenant?.name ?? ''} />
        </div>
        {sidebar}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-slate-900/40" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 p-3">
              <Logo name={me?.tenant?.name ?? ''} />
              <button className="p-2" onClick={() => setDrawer(false)} aria-label={t('common.close')}>
                <X className="size-5" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur md:px-4">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)} aria-label={t('nav.more')}>
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 lg:hidden">
            <Logo name={me?.tenant?.name ?? ''} />
          </div>
          <div className="hidden flex-1 lg:block" />
          <CheckInButton />
          <AlertsBell />
          <UserMenu />
        </header>

        {!online && (
          <div className="no-print flex items-center gap-2 bg-slate-800 px-4 py-2 text-sm text-white">
            <WifiOff className="size-4" /> {t('shell.offline')}
          </div>
        )}
        {me?.supportMode && (
          <div className="no-print flex items-center justify-between gap-2 bg-violet-600 px-4 py-2 text-sm text-white">
            <span className="flex items-center gap-2">
              <ShieldAlert className="size-4" /> {t('shell.supportMode')}
            </span>
            <ExitSupport />
          </div>
        )}
        {readOnly ? (
          <div className="no-print bg-rose-600 px-4 py-2 text-sm font-medium text-white">{t('shell.readOnly')}</div>
        ) : me?.subscription?.showBanner && me.subscription.daysLeft !== null ? (
          <div className="no-print bg-amber-100 px-4 py-2 text-sm text-amber-900">
            {me.subscription.state === 'TRIAL' ? t('shell.trialEnds', { days: me.subscription.daysLeft }) : t('shell.subscriptionEnds', { days: me.subscription.daysLeft })}
          </div>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto pb-20 lg:pb-0">{children}</main>

        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, minmax(0, 1fr))` }}>
          {mobileItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/orders'}
              className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}
            >
              {n.icon}
              <span className="truncate">{t(n.label)}</span>
            </NavLink>
          ))}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
            <Menu className="size-5" />
            {t('nav.more')}
          </button>
        </nav>
      </div>
    </div>
  );
}

function ExitSupport() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <button
      className="rounded-md bg-white/20 px-2 py-1 text-xs font-semibold hover:bg-white/30"
      onClick={async () => {
        await api.post('/api/auth/logout');
        qc.clear();
        navigate('/login');
      }}
    >
      {t('shell.exitSupport')}
    </button>
  );
}

function CheckInButton() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attendance-me'], queryFn: () => api.get('/api/staff/attendance/me'), enabled: !!me?.canCheckIn && !me?.supportMode });
  const m = useMutation({
    mutationFn: (kind: 'in' | 'out') => api.post(`/api/staff/attendance/check-${kind}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance-me'] });
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(e),
  });
  if (!me?.canCheckIn || !q.data?.linked) return null;
  const rec = q.data.today;
  if (rec?.checkOut) return null;
  return (
    <Button size="sm" variant={rec?.checkIn ? 'secondary' : 'success'} icon={<Clock className="size-4" />} loading={m.isPending} onClick={() => m.mutate(rec?.checkIn ? 'out' : 'in')}>
      <span className="hidden sm:inline">{rec?.checkIn ? t('shell.checkOut') : t('shell.checkIn')}</span>
    </Button>
  );
}

function AlertsBell() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const enabled = can('tracking', 'view') || can('dashboard', 'view') || can('pos', 'view');
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api.get('/api/tracking/alerts'), enabled, refetchInterval: 120_000 });
  if (!enabled) return null;
  const c = q.data?.counts ?? { overdue: 0, uncollected: 0, express: 0, onHold: 0 };
  const total = c.overdue + c.uncollected;
  const section = (title: string, list: any[], color: string) =>
    list?.length ? (
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-500">
          <span>{title}</span>
          <Badge color={color}>{list.length}</Badge>
        </div>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.slice(0, 8).map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50">
              <span className="font-semibold">#{o.orderNo}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600 bidi">{o.customer?.name ?? ''}</span>
              <span className="text-xs text-slate-500">{dateTime(o.expectedAt)}</span>
            </Link>
          ))}
        </div>
      </div>
    ) : null;
  return (
    <>
      <button className="relative rounded-lg p-2 hover:bg-slate-100" onClick={() => setOpen(true)} aria-label={t('shell.alerts')}>
        <Bell className="size-5 text-slate-600" />
        {total > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{total}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('shell.alerts')}>
        {total + c.express + c.onHold === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('shell.noAlerts')}</p>
        ) : (
          <>
            {section(t('tracking.overdue'), q.data?.overdue, 'red')}
            {section(t('tracking.uncollected', { days: q.data?.uncollectedDays ?? 30 }), q.data?.uncollected, 'amber')}
            {section(t('tracking.expressActive'), q.data?.express, 'purple')}
            {section(t('tracking.onHold'), q.data?.onHold, 'orange')}
          </>
        )}
      </Modal>
    </>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'password' | 'pin' | null>(null);
  const [form, setForm] = useState({ current: '', next: '', pin: '' });

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/login');
  };
  const lock = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/login?pin=1');
  };
  const save = useMutation({
    mutationFn: () =>
      dialog === 'password'
        ? api.post('/api/auth/change-password', { currentPassword: form.current, newPassword: form.next })
        : api.post('/api/auth/pin/set', { pin: form.pin || null }),
    onSuccess: () => {
      toast.success(dialog === 'password' ? t('auth.passwordChanged') : t('auth.pinSet'));
      setDialog(null);
      setForm({ current: '', next: '', pin: '' });
    },
    onError: (e) => toast.error(e),
  });

  return (
    <div className="relative">
      <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100" onClick={() => setOpen((o) => !o)}>
        <div className="grid size-8 place-items-center rounded-full bg-slate-200 text-slate-700">
          <UserRound className="size-4" />
        </div>
        <div className="hidden text-left md:block">
          <div className="max-w-[160px] truncate text-sm font-semibold leading-tight bidi">{me?.user?.name}</div>
          <div className="text-[11px] leading-tight text-slate-500">{me?.role?.name}</div>
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2 md:hidden">
              <div className="truncate text-sm font-semibold bidi">{me?.user?.name}</div>
              <div className="text-xs text-slate-500">{me?.role?.name}</div>
            </div>
            {!me?.supportMode && (
              <>
                <MenuItem icon={<Users className="size-4" />} onClick={lock}>
                  {t('shell.switchUser')}
                </MenuItem>
                <MenuItem icon={<Lock className="size-4" />} onClick={() => { setDialog('pin'); setOpen(false); }}>
                  {t('shell.setPin')}
                </MenuItem>
                <MenuItem icon={<KeyRound className="size-4" />} onClick={() => { setDialog('password'); setOpen(false); }}>
                  {t('shell.changePassword')}
                </MenuItem>
              </>
            )}
            <MenuItem icon={<LogOut className="size-4" />} onClick={logout}>
              {t('shell.logout')}
            </MenuItem>
          </div>
        </>
      )}
      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'password' ? t('shell.changePassword') : t('shell.setPin')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        {dialog === 'password' ? (
          <div className="space-y-3">
            <Field label={t('auth.currentPassword')}>
              <Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </Field>
            <Field label={t('auth.newPassword')}>
              <Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
            </Field>
          </div>
        ) : (
          <Field label={t('auth.pin')} hint={t('auth.pinHint')}>
            <Input inputMode="numeric" maxLength={4} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
          </Field>
        )}
      </Modal>
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

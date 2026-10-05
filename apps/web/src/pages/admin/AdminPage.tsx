import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { LogOut, Plus, Search, ShieldCheck } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, dateTime, money } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, MoneyInput, Select, Stat, Switch, Tabs, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';

const STATE_COLOR: Record<string, string> = { TRIAL: 'amber', ACTIVE: 'green', EXPIRED: 'red', SUSPENDED: 'dark' };

/** NewMux platform panel: tenants, plans, subscriptions and usage (no tenant financials). */
export default function AdminPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'tenants' | 'plans'>('tenants');
  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/login');
  };
  return (
    <div className="min-h-full">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-slate-900 px-4 text-white">
        <div className="flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-sky-300" /> {t('admin.title')}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden sm:inline">{me?.user?.email}</span>
          <button onClick={logout} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/10">
            <LogOut className="size-4" /> {t('shell.logout')}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-3 md:p-6">
        <Overview />
        <Tabs className="my-4" value={tab} onChange={setTab} tabs={[{ value: 'tenants', label: t('admin.tenants') }, { value: 'plans', label: t('admin.plans') }]} />
        {tab === 'tenants' ? <Tenants /> : <Plans />}
      </div>
    </div>
  );
}

function Overview() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['platform-stats'], queryFn: () => api.get('/api/platform/stats') });
  if (!q.data) return null;
  const s = q.data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Stat label={t('admin.tenants')} value={s.tenants} />
      {(['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'] as const).map((k) => (
        <Stat key={k} label={t(`admin.state.${k}`)} value={s.byState[k] ?? 0} tone={k === 'EXPIRED' && s.byState[k] > 0 ? 'bad' : 'default'} />
      ))}
      <Stat label={t('admin.orders30')} value={s.orders30} sub={`${s.users} ${t('admin.users').toLowerCase()}`} />
    </div>
  );
}

function Tenants() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['platform-tenants', dq], queryFn: () => api.get(`/api/platform/tenants${qs({ q: dq })}`) });
  return (
    <>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('admin.newTenant')}
        </Button>
      </div>
      <p className="mb-2 text-xs text-slate-500">{t('admin.noFinancials')}</p>
      <Card bodyClassName="p-0 overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.tenants')}</th>
                <th>{t('settings.plan')}</th>
                <th>{t('settings.status')}</th>
                <th>{t('settings.renewal')}</th>
                <th>{t('admin.payment')}</th>
                <th className="num">{t('admin.users')}</th>
                <th className="num">{t('admin.orders30')}</th>
                <th className="num">{t('admin.customers')}</th>
                <th>{t('admin.lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.tenants ?? []).map((x: any) => (
                <tr key={x.id} className="cursor-pointer" onClick={() => setSelected(x.id)}>
                  <td>
                    <div className="font-semibold bidi">{x.name}</div>
                    <div className="text-xs text-slate-500">
                      {x.slug} · {date(x.createdAt)}
                    </div>
                  </td>
                  <td>{x.plan?.name ?? '—'}</td>
                  <td>
                    <Badge color={STATE_COLOR[x.subscription.state]}>{t(`admin.state.${x.subscription.state}`)}</Badge>
                    {x.supportAccessUntil && new Date(x.supportAccessUntil) > new Date() && <Badge color="purple" className="ml-1">{t('admin.supportBadge')}</Badge>}
                  </td>
                  <td className="whitespace-nowrap">{date(x.subscription.endsAt)}</td>
                  <td>{x.subscriptionPaymentStatus}</td>
                  <td className="num">
                    {x.usage.users}/{x.maxUsers ?? '—'}
                  </td>
                  <td className="num">{x.usage.orders30}</td>
                  <td className="num">{x.usage.customers}</td>
                  <td className="whitespace-nowrap text-xs text-slate-600">{dateTime(x.usage.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <TenantModal id={selected} onClose={() => setSelected(null)} />
      <CreateTenantModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function TenantModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['platform-tenant', id], queryFn: () => api.get(`/api/platform/tenants/${id}`), enabled: !!id });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get('/api/platform/plans') });
  const [v, setV] = useState<any>(null);
  const [months, setMonths] = useState('1');
  const tn = q.data?.tenant;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (tn && loadedFor !== tn.id + tn.updatedAt) {
    setLoadedFor(tn.id + tn.updatedAt);
    setV({
      planId: tn.planId ?? '',
      status: tn.status,
      trialEndsAt: tn.trialEndsAt?.slice(0, 10) ?? '',
      currentPeriodEnd: tn.currentPeriodEnd?.slice(0, 10) ?? '',
      subscriptionStart: tn.subscriptionStart?.slice(0, 10) ?? '',
      subscriptionPaymentStatus: tn.subscriptionPaymentStatus,
      maxUsersOverride: tn.maxUsersOverride ?? '',
      adminNotes: tn.adminNotes ?? '',
    });
  }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
    void qc.invalidateQueries({ queryKey: ['platform-tenant', id] });
    void qc.invalidateQueries({ queryKey: ['platform-stats'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/platform/tenants/${id}`, {
        planId: v.planId || null,
        status: v.status,
        trialEndsAt: v.trialEndsAt ? `${v.trialEndsAt}T23:59:59+03:00` : null,
        currentPeriodEnd: v.currentPeriodEnd ? `${v.currentPeriodEnd}T23:59:59+03:00` : null,
        subscriptionStart: v.subscriptionStart ? `${v.subscriptionStart}T00:00:00+03:00` : null,
        subscriptionPaymentStatus: v.subscriptionPaymentStatus,
        maxUsersOverride: v.maxUsersOverride === '' ? null : Number(v.maxUsersOverride),
        adminNotes: v.adminNotes,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const renew = useMutation({
    mutationFn: () => api.post(`/api/platform/tenants/${id}/renew`, { months: Number(months) }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const support = useMutation({
    mutationFn: () => api.post(`/api/platform/tenants/${id}/support-session`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={tn?.name ?? ''} footer={v && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      {!tn || !v ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-slate-500">{t('admin.users')}</div><div className="font-semibold">{tn.usage.users}</div></div>
            <div><div className="text-slate-500">{t('admin.ordersAll')}</div><div className="font-semibold">{tn.usage.ordersAll}</div></div>
            <div><div className="text-slate-500">{t('admin.customers')}</div><div className="font-semibold">{tn.usage.customers}</div></div>
            <div><div className="text-slate-500">{t('admin.lastSeen')}</div><div className="font-semibold">{dateTime(tn.usage.lastSeen)}</div></div>
          </div>
          <div className="text-sm text-slate-600">
            {tn.owners.map((o: any) => (
              <div key={o.id}>
                {o.name} · {o.username} {o.email && `· ${o.email}`}
              </div>
            ))}
            {tn.phone && <div>{tn.phone}</div>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.plan')}>
              <Select value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}>
                {(plans.data?.plans ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('settings.status')}>
              <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
                {['TRIAL', 'ACTIVE', 'SUSPENDED'].map((s) => (
                  <option key={s} value={s}>
                    {t(`admin.state.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.trialEnds')}>
              <Input type="date" value={v.trialEndsAt} onChange={(e) => setV({ ...v, trialEndsAt: e.target.value })} />
            </Field>
            <Field label={t('admin.subscriptionStart')}>
              <Input type="date" value={v.subscriptionStart} onChange={(e) => setV({ ...v, subscriptionStart: e.target.value })} />
            </Field>
            <Field label={t('admin.periodEnd')}>
              <Input type="date" value={v.currentPeriodEnd} onChange={(e) => setV({ ...v, currentPeriodEnd: e.target.value })} />
            </Field>
            <Field label={t('admin.payment')}>
              <Select value={v.subscriptionPaymentStatus} onChange={(e) => setV({ ...v, subscriptionPaymentStatus: e.target.value })}>
                {['PAID', 'UNPAID', 'OVERDUE'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.maxUsersOverride')}>
              <Input inputMode="numeric" value={v.maxUsersOverride} onChange={(e) => setV({ ...v, maxUsersOverride: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <Field label={t('admin.notes')}>
            <Textarea value={v.adminNotes} onChange={(e) => setV({ ...v, adminNotes: e.target.value })} />
          </Field>
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
            <Field label={t('admin.months')}>
              <Input className="w-20" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Button variant="success" loading={renew.isPending} onClick={() => renew.mutate()}>
              {t('admin.renew')}
            </Button>
          </div>
          <div className={clsx('rounded-xl border p-3 text-sm', tn.supportAccessUntil && new Date(tn.supportAccessUntil) > new Date() ? 'border-violet-200 bg-violet-50' : 'border-slate-200')}>
            {tn.supportAccessUntil && new Date(tn.supportAccessUntil) > new Date() ? (
              <div className="flex items-center justify-between gap-2">
                <span>{t('settings.supportUntil', { date: dateTime(tn.supportAccessUntil) })}</span>
                <Button size="sm" loading={support.isPending} onClick={() => support.mutate()}>
                  {t('admin.enterSupport')}
                </Button>
              </div>
            ) : (
              <span className="text-slate-500">{t('admin.supportNotGranted')}</span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function CreateTenantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get('/api/platform/plans'), enabled: open });
  const [v, setV] = useState({ name: '', slug: '', phone: '', ownerName: '', username: 'owner', email: '', password: '', planCode: 'business', trialDays: '14', template: 'standard' });
  const m = useMutation({
    mutationFn: () =>
      api.post('/api/platform/tenants', {
        shop: { name: v.name, slug: v.slug, phone: v.phone || null },
        owner: { name: v.ownerName, username: v.username, email: v.email || null, password: v.password },
        template: v.template,
        planCode: v.planCode,
        trialDays: Number(v.trialDays) || 0,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
      void qc.invalidateQueries({ queryKey: ['platform-stats'] });
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('admin.newTenant')} footer={<Button loading={m.isPending} onClick={() => m.mutate()}>{t('common.create')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('signup.shopName')}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t('signup.shopCode')}>
          <Input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
        </Field>
        <Field label={t('signup.phone')}>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
        <Field label={t('settings.plan')}>
          <Select value={v.planCode} onChange={(e) => setV({ ...v, planCode: e.target.value })}>
            {(plans.data?.plans ?? []).map((p: any) => (
              <option key={p.id} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('signup.ownerName')}>
          <Input value={v.ownerName} onChange={(e) => setV({ ...v, ownerName: e.target.value })} />
        </Field>
        <Field label={t('signup.username')}>
          <Input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} />
        </Field>
        <Field label={t('signup.email')}>
          <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label={t('signup.password')}>
          <Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </Field>
        <Field label={t('admin.trialEnds')} hint={t('admin.days')}>
          <Input inputMode="numeric" value={v.trialDays} onChange={(e) => setV({ ...v, trialDays: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label={t('signup.priceList')}>
          <Select value={v.template} onChange={(e) => setV({ ...v, template: e.target.value })}>
            <option value="standard">{t('admin.templates.standard')}</option>
            <option value="dry_cleaner">{t('admin.templates.dry_cleaner')}</option>
            <option value="empty">{t('admin.templates.empty')}</option>
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function Plans() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get('/api/platform/plans') });
  const [editing, setEditing] = useState<any | null>(null);
  const save = useMutation({
    mutationFn: (p: any) => {
      const body = { code: p.code, name: p.name, priceMonthly: Number(p.priceMonthly), maxUsers: Number(p.maxUsers), features: p.features, isActive: p.isActive, sortOrder: Number(p.sortOrder) || 0 };
      return p.id ? api.patch(`/api/platform/plans/${p.id}`, body) : api.post('/api/platform/plans', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-plans'] });
      setEditing(null);
    },
    onError: (e) => toast.error(e),
  });
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ code: '', name: '', priceMonthly: '0', maxUsers: '3', features: { customPermissions: false, dataExport: true }, isActive: true, sortOrder: 0 })}>
          {t('common.add')}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {(q.data?.plans ?? []).map((p: any) => (
          <Card key={p.id} title={p.name} actions={<Button size="sm" variant="ghost" onClick={() => setEditing({ ...p, priceMonthly: String(p.priceMonthly) })}>{t('common.edit')}</Button>}>
            <div className="text-3xl font-bold">BHD {money(p.priceMonthly)}</div>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li>
                {t('admin.maxUsers')}: <b>{p.maxUsers}</b>
              </li>
              <li>
                {t('admin.customPermissions')}: <b>{p.features.customPermissions ? t('common.yes') : t('common.no')}</b>
              </li>
              <li>
                {t('admin.dataExport')}: <b>{p.features.dataExport ? t('common.yes') : t('common.no')}</b>
              </li>
              <li>{t('admin.tenantsCount', { count: p._count.tenants })}</li>
            </ul>
          </Card>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('common.edit') : t('common.add')} footer={<Button loading={save.isPending} onClick={() => save.mutate(editing)}>{t('common.save')}</Button>}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.planName')}>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label={t('admin.planCode')}>
              <Input value={editing.code} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase() })} />
            </Field>
            <Field label={t('admin.price')}>
              <MoneyInput value={editing.priceMonthly} onChange={(x) => setEditing({ ...editing, priceMonthly: x })} />
            </Field>
            <Field label={t('admin.maxUsers')}>
              <Input inputMode="numeric" value={editing.maxUsers} onChange={(e) => setEditing({ ...editing, maxUsers: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Switch checked={editing.features.customPermissions} onChange={(x) => setEditing({ ...editing, features: { ...editing.features, customPermissions: x } })} label={t('admin.customPermissions')} />
            <Switch checked={editing.features.dataExport} onChange={(x) => setEditing({ ...editing, features: { ...editing.features, dataExport: x } })} label={t('admin.dataExport')} />
            <Switch checked={editing.isActive} onChange={(x) => setEditing({ ...editing, isActive: x })} label={t('common.active')} />
          </div>
        )}
      </Modal>
    </>
  );
}


import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Clock, FileWarning, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { Card, ErrorBox, Loading, PageHeader, Stat } from '../../components/ui';
import { BarList, TrendChart } from '../../components/TrendChart';

const REVENUE = '#2a78d6';
const EXPENSES = '#eb6834';

/** Owner dashboard — today at a glance and month-to-date, usable on a phone. */
export default function DashboardPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/api/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const d = q.data;
  const fin = d.showFinance;

  // Cumulative month-to-date series.
  const labels: string[] = d.month.trend.map((p: any) => p.date);
  let r = 0;
  let e = 0;
  const cumRev: number[] = [];
  const cumExp: number[] = [];
  for (const p of d.month.trend) {
    r += p.revenue ?? 0;
    e += p.expenses ?? 0;
    cumRev.push(Math.round(r * 1000) / 1000);
    cumExp.push(Math.round(e * 1000) / 1000);
  }

  const alertList = (title: string, icon: React.ReactNode, list: any[], tone: string) =>
    list.length > 0 && (
      <div>
        <div className={clsx('mb-1 flex items-center gap-1.5 text-xs font-semibold', tone)}>
          {icon}
          {title} ({list.length})
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.map((o: any) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <span className="font-semibold tabular-nums">#{o.orderNo}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600 bidi">{o.customer?.name ?? ''}</span>
                <span className="text-xs text-slate-500">{dateTime(o.expectedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );

  const anyAlerts = d.alerts.overdue.length + d.alerts.uncollected.length + d.alerts.express.length + d.alerts.documents.length > 0;

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6">
      <PageHeader title={t('dashboard.title')} subtitle={dateTime(new Date())} />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('dashboard.today')}</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('dashboard.ordersToday')} value={d.today.orders} sub={t('dashboard.ofWhichPieces', { count: d.today.pieces })} />
        <Stat label={t('dashboard.salesToday')} value={money(d.today.sales)} />
        {fin && <Stat label={t('dashboard.revenueToday')} value={money(d.today.revenue)} />}
        <Stat label={t('dashboard.cashInDrawer')} value={d.today.cashClosed ? t('dashboard.cashClosed') : money(d.today.cashInDrawer)} />
        {fin && <Stat label={t('dashboard.expensesToday')} value={money(d.today.expenses)} />}
        <Stat label={t('dashboard.readyNotCollected')} value={d.today.readyNotCollected} />
        <Stat label={t('dashboard.overdue')} value={d.today.overdue} tone={d.today.overdue > 0 ? 'bad' : 'default'} icon={d.today.overdue > 0 ? <AlertTriangle className="size-4 text-rose-500" /> : undefined} />
        {!fin && <Stat label={t('orders.express')} value={d.today.express} />}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('dashboard.monthToDate')}</h2>
      {fin ? (
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="card min-w-0 p-4 md:col-span-1">
            <div className="text-xs font-medium text-slate-500">{t('dashboard.profitMtd')}</div>
            <div className={clsx('mt-1 text-4xl font-bold md:text-5xl', d.month.profit < 0 ? 'text-rose-700' : 'text-slate-900')}>{money(d.month.profit)}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: REVENUE }} />
                  {t('dashboard.revenueNet')}
                </div>
                <div className="text-lg font-semibold">{money(d.month.revenue)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: EXPENSES }} />
                  {t('dashboard.expenses')}
                </div>
                <div className="text-lg font-semibold">{money(d.month.expenses)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t('dashboard.ordersMtd')}</div>
                <div className="text-lg font-semibold">{d.month.orders}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t('dashboard.newCustomers')}</div>
                <div className="text-lg font-semibold">{d.month.newCustomers}</div>
              </div>
            </div>
          </div>
          <Card className="min-w-0 md:col-span-2" title={t('dashboard.trend')} actions={<span className="text-xs text-slate-500">{t('dashboard.cumulativeHint')}</span>}>
            <TrendChart
              labels={labels}
              series={[
                { key: 'rev', label: t('dashboard.revenueNet'), color: REVENUE, values: cumRev },
                { key: 'exp', label: t('dashboard.expenses'), color: EXPENSES, values: cumExp },
              ]}
              extraRow={{ label: t('dashboard.profit'), values: cumRev.map((v, i) => Math.round((v - cumExp[i]) * 1000) / 1000) }}
            />
          </Card>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('dashboard.ordersMtd')} value={d.month.orders} />
          <Stat label={t('dashboard.salesMtd')} value={money(d.month.sales)} />
          <Stat label={t('dashboard.newCustomers')} value={d.month.newCustomers} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="min-w-0" title={t('dashboard.topItems')}>
          {d.month.topItems.length ? (
            <BarList rows={d.month.topItems.map((x: any) => ({ label: x.name, value: x.pieces, sub: fin ? `· ${money(x.amount)}` : undefined }))} />
          ) : (
            <p className="text-sm text-slate-500">{t('dashboard.noTrend')}</p>
          )}
        </Card>
        <Card title={t('dashboard.topServices')}>
          {d.month.topServices.length ? (
            <BarList rows={d.month.topServices.map((x: any) => ({ label: x.name, value: x.pieces, sub: fin ? `· ${money(x.amount)}` : undefined }))} />
          ) : (
            <p className="text-sm text-slate-500">{t('dashboard.noTrend')}</p>
          )}
        </Card>
        <Card title={t('dashboard.alerts')}>
          {!anyAlerts ? (
            <p className="text-sm text-emerald-700">{t('dashboard.noAlerts')}</p>
          ) : (
            <div className="space-y-4">
              {alertList(t('tracking.overdue'), <AlertTriangle className="size-3.5" />, d.alerts.overdue, 'text-rose-700')}
              {alertList(t('tracking.uncollected', { days: d.alerts.uncollectedDays }), <Clock className="size-3.5" />, d.alerts.uncollected, 'text-amber-700')}
              {alertList(t('tracking.expressActive'), <Zap className="size-3.5" />, d.alerts.express, 'text-violet-700')}
              {d.alerts.documents.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                    <FileWarning className="size-3.5" />
                    {t('dashboard.documents')} ({d.alerts.documents.length})
                  </div>
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {d.alerts.documents.map((a: any, i: number) => (
                      <li key={i}>
                        <Link to={`/staff/employees/${a.employeeId}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                          <span className="min-w-0 flex-1 truncate bidi">
                            {a.employeeName} · {a.document}
                          </span>
                          <span className={clsx('text-xs font-semibold', a.level === 'expired' ? 'text-rose-600' : a.level === 'week' ? 'text-amber-600' : 'text-slate-500')}>
                            {a.daysLeft < 0 ? t('dashboard.expired', { days: -a.daysLeft }) : t('dashboard.expiresIn', { days: a.daysLeft })}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

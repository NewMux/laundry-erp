import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Columns3, Plus, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, phone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Button, Empty, ErrorBox, Input, Loading, PageHeader, Tabs } from '../../components/ui';
import { OrderCard, OrderFlags, PaymentBadge, StatusBadge, type OrderSummary } from '../../components/orders';

type Filter = 'active' | 'ready' | 'overdue' | 'express' | 'unpaid' | 'onHold' | 'delivered' | 'cancelled' | 'all';

const FILTERS: Record<Filter, Record<string, unknown>> = {
  active: { status: 'RECEIVED,IN_PROCESS,IRONING,READY' },
  ready: { status: 'READY' },
  overdue: { overdue: 1 },
  express: { express: 1, status: 'RECEIVED,IN_PROCESS,IRONING,READY' },
  unpaid: { unpaid: 1 },
  onHold: { onHold: 1 },
  delivered: { status: 'DELIVERED' },
  cancelled: { status: 'CANCELLED' },
  all: {},
};

export default function OrdersPage() {
  const { t } = useTranslation();
  const { can, hasCap } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const query = useQuery({
    queryKey: ['orders', filter, dq, from, to, page],
    queryFn: () => api.get(`/api/orders${qs({ ...FILTERS[filter], q: dq, from, to, page, pageSize: 50 })}`),
  });
  const orders: OrderSummary[] = query.data?.orders ?? [];
  const showPrices = hasCap('viewPrices');

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6">
      <PageHeader
        title={t('orders.title')}
        actions={
          <>
            {can('tracking') && (
              <Button variant="secondary" icon={<Columns3 className="size-4" />} onClick={() => navigate('/orders/board')}>
                {t('orders.board')}
              </Button>
            )}
            {can('pos', 'create') && (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/pos')}>
                {t('nav.pos')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder={t('orders.searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label={t('common.from')} />
          <span className="text-slate-400">–</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label={t('common.to')} />
        </div>
      </div>
      <Tabs
        className="mb-3"
        value={filter}
        onChange={(f) => { setFilter(f); setPage(1); }}
        tabs={(Object.keys(FILTERS) as Filter[]).map((f) => ({ value: f, label: t(`orders.filters.${f}`) }))}
      />
      <ErrorBox error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : !orders.length ? (
        <div className="card">
          <Empty icon={<ClipboardList className="size-10" />} title={t('orders.noOrders')} />
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {orders.map((o) => (
              <OrderCard key={o.id} o={o} compact />
            ))}
          </div>
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('orders.orderNo')}</th>
                  <th>{t('orders.received')}</th>
                  <th>{t('orders.customer')}</th>
                  <th className="num">{t('orders.pieces')}</th>
                  <th>{t('orders.status')}</th>
                  <th>{t('orders.expected')}</th>
                  {showPrices && <th className="num">{t('orders.total')}</th>}
                  {showPrices && <th className="num">{t('orders.due')}</th>}
                  {showPrices && <th>{t('orders.payment')}</th>}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/orders/${o.id}`)}>
                    <td className="font-bold tabular-nums">
                      <Link to={`/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>
                        #{o.orderNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{dateTime(o.createdAt)}</td>
                    <td>
                      <div className="font-medium bidi">{o.customer?.name ?? t('common.walkIn')}</div>
                      {o.customer?.mobile && <div className="text-xs text-slate-500">{phone(o.customer.mobile)}</div>}
                    </td>
                    <td className="num">{o.pieceCount}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={o.status} />
                        <OrderFlags o={o} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{dateTime(o.expectedAt)}</td>
                    {showPrices && <td className="num">{money(o.total)}</td>}
                    {showPrices && <td className="num font-semibold">{o.balanceDue ? money(o.balanceDue) : '—'}</td>}
                    {showPrices && (
                      <td>
                        <PaymentBadge state={o.paymentState} onAccount={o.onAccount} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={50} total={query.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-2 text-xs text-slate-500">{t('common.showing', { count: total })}</p>;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-slate-500">{t('common.showing', { count: total })}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('common.back')}
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}

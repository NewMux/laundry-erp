import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PackageCheck, Smartphone, Truck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, phone } from '../../lib/format';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Tabs } from '../../components/ui';
import { HandoverBadge, HandoverDetails, type HandoverInfo } from '../../components/handover';
import { StatusBadge } from '../../components/orders';
import { useToast } from '../../components/toast';

type View = 'open' | 'deliveries' | 'cancelled';

interface AppOrder extends HandoverInfo {
  id: string;
  orderNo: number | null;
  status: string;
  createdAt: string;
  expectedAt: string | null;
  total?: number;
  notes: string | null;
  customer: { id: string; name: string; mobile?: string } | null;
  items: { itemName: string; quantity: number; notes: string | null }[];
  onHold: boolean;
}

/**
 * Orders from the customer app. "Waiting" are pre-orders the shop doesn't
 * have yet: receive them when they're dropped off or the driver brings them
 * in. "Deliveries" are orders going back to customers by driver.
 */
export default function AppOrdersPage() {
  const { t } = useTranslation();
  const { can, hasCap, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('open');
  const q = useQuery({ queryKey: ['app-orders', view], queryFn: () => api.get<{ orders: AppOrder[] }>(`/api/orders/app?view=${view}`), refetchInterval: 30_000 });
  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body?: unknown }) => api.post(`/api/orders/${id}/${path}`, body ?? {}),
    onSuccess: (data, v) => {
      void qc.invalidateQueries({ queryKey: ['app-orders'] });
      if (v.path === 'receive-app') toast.success(data.charged ? t('handover.receivedCharged', { no: data.order.orderNo }) : t('handover.received', { no: data.order.orderNo }));
      else toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(e),
  });
  const driverRights = !readOnly && (can('tracking', 'edit') || can('delivery', 'create'));
  const busy = (id: string, path: string) => act.isPending && act.variables?.id === id && act.variables?.path === path;

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader title={t('handover.inbox')} subtitle={t('handover.inboxHint')} />
      <Tabs
        className="mb-4"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'open', label: t('handover.views.open') },
          { value: 'deliveries', label: t('handover.views.deliveries') },
          { value: 'cancelled', label: t('handover.views.cancelled') },
        ]}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data?.orders.length ? (
        <Empty icon={<Smartphone className="size-8" />} title={t(`handover.empty.${view}`)} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.orders.map((o) => (
            <Card key={o.id} bodyClassName="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/orders/${o.id}`} className="text-lg font-bold tabular-nums hover:underline">
                  {o.orderNo ? `#${o.orderNo}` : o.appRef}
                </Link>
                <span className="flex flex-wrap gap-1">
                  {o.status !== 'DRAFT' && <StatusBadge status={o.status} />}
                  <HandoverBadge o={o} />
                </span>
              </div>
              <div className="text-sm">
                <div className="font-semibold bidi">{o.customer?.name ?? '—'}</div>
                {o.customer?.mobile && <div className="text-slate-600">{phone(o.customer.mobile)}</div>}
                <div className="text-xs text-slate-500">{t('handover.placed', { when: dateTime(o.createdAt) })}</div>
              </div>
              <ul className="text-sm text-slate-700">
                {o.items.map((it, i) => (
                  <li key={i}>
                    {it.quantity}× <bdi>{it.itemName}</bdi>
                    {it.notes && (
                      <span className="text-amber-800">
                        {' — '}
                        <bdi>{it.notes}</bdi>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {o.notes && <div className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700 bidi">{o.notes}</div>}
              <HandoverDetails o={o} compact />
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {hasCap('viewPrices') && o.total !== undefined && <span className="mr-auto font-semibold tabular-nums">{money(o.total)}</span>}
                {view === 'open' && o.handoverStatus === 'AWAITING_PICKUP' && driverRights && (
                  <Button size="sm" variant="secondary" icon={<Truck className="size-4" />} loading={busy(o.id, 'handover')} onClick={() => act.mutate({ id: o.id, path: 'handover', body: { to: 'PICKUP_EN_ROUTE' } })}>
                    {t('handover.driverOnWay')}
                  </Button>
                )}
                {view === 'open' && !readOnly && can('pos', 'create') && (
                  <Button size="sm" variant="success" icon={<PackageCheck className="size-4" />} loading={busy(o.id, 'receive-app')} onClick={() => act.mutate({ id: o.id, path: 'receive-app' })}>
                    {o.inbound === 'PICKUP' ? t('handover.receivePickup') : t('handover.receiveDropoff')}
                  </Button>
                )}
                {view === 'deliveries' && o.status === 'READY' && !o.onHold && driverRights && o.handoverStatus !== 'OUT_FOR_DELIVERY' && (
                  <Button size="sm" variant="secondary" icon={<Truck className="size-4" />} loading={busy(o.id, 'handover')} onClick={() => act.mutate({ id: o.id, path: 'handover', body: { to: 'OUT_FOR_DELIVERY' } })}>
                    {t('handover.outForDelivery')}
                  </Button>
                )}
                {view === 'deliveries' && o.handoverStatus === 'OUT_FOR_DELIVERY' && (
                  <Link to={`/orders/${o.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {t('handover.deliverOnOrder')}
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
